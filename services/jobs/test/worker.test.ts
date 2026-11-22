import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { JobStore } from "../src/store.ts";
import { JobWorker } from "../src/worker.ts";
import { HandlerFailure } from "../src/types.ts";
import { parseClientJobRequest, watchJob, encodeJobEvent } from "../src/transport.ts";
import { runIsolatedProcess } from "../src/process.ts";

const ctx = { ownerId: "owner", projectId: "project" };
const request = (id = "upload") => ({ kind: "analysis" as const, input: { kind: "upload" as const, id }, idempotencyKey: `request-${id}` });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-worker-test-"));
  const options = { databasePath: path.join(root, "jobs.sqlite"), artifactRoot: path.join(root, "artifacts"), limits: { leaseMs: 200, retryBaseMs: 1 } };
  const store = new JobStore(options);
  return { root, store, options, cleanup: async () => { store.close(); await rm(root, { recursive: true, force: true }); } };
}
const waitFor = async (predicate: () => boolean) => { const end = Date.now() + 2_000; while (!predicate()) { if (Date.now() > end) throw new Error("Timed out"); await delay(5); } };

test("a restarted worker consumes durable queued work and preserves terminal results", async () => {
  const f = await fixture();
  try {
    const job = f.store.enqueue(ctx, request()).job;
    f.store.close();
    const reopened = new JobStore(f.options);
    let calls = 0;
    const worker = new JobWorker(reopened, { heartbeatMs: 20, handlers: { analysis: async (execution) => {
      calls++; assert.equal(execution.ownerId, ctx.ownerId); assert.equal(execution.projectId, ctx.projectId);
      execution.progress({ fraction: 0.5, stage: "analyzing" }); return { output: { kind: "analysis", id: "analysis" } };
    } } });
    assert.equal(worker.tick(), 1); await worker.drain();
    assert.equal(reopened.get(ctx, job.id).state, "succeeded");
    await worker.stop(); reopened.close();
    const again = new JobStore(f.options);
    const next = new JobWorker(again, { heartbeatMs: 20, handlers: { analysis: async () => { calls++; return { output: { kind: "analysis", id: "duplicate" } }; } } });
    assert.equal(next.tick(), 0); assert.equal(calls, 1); assert.equal(again.get(ctx, job.id).output?.id, "analysis");
    await next.stop(); again.close();
  } finally { await f.cleanup(); }
});

test("disconnecting a progress viewer leaves the job alive and reconnect returns its latest state", async () => {
  const f = await fixture();
  try {
    const job = f.store.enqueue(ctx, request()).job;
    const viewer = new AbortController();
    const stream = watchJob(f.store, ctx, job.id, { signal: viewer.signal, pollMs: 5 });
    const snapshot = (await stream.next()).value!;
    assert.equal(snapshot.data.state, "pending"); assert.match(encodeJobEvent(snapshot), /event: job\ndata:/);
    viewer.abort(); await stream.return(undefined);
    assert.equal(f.store.get(ctx, job.id).cancelRequestedAt, null);
    const claim = f.store.claim("worker-one")!;
    f.store.finish(claim, { output: { kind: "analysis", id: "result" } });
    const reconnect = watchJob(f.store, ctx, job.id, { after: snapshot.id });
    assert.equal((await reconnect.next()).value?.data.state, "succeeded"); assert.equal((await reconnect.next()).done, true);
    assert.throws(() => parseClientJobRequest({ ...request(), ownerId: "somebody-else" }));
    assert.throws(() => parseClientJobRequest({ ...request(), retry: { maxAttempts: 3, safeToRetry: true } }));
  } finally { await f.cleanup(); }
});

test("running cancellation aborts owned work and holds capacity until cleanup finishes", async () => {
  const f = await fixture();
  let started = false; let stopped = false; let release!: () => void;
  const stoppedBarrier = new Promise<void>((resolve) => { release = resolve; });
  const worker = new JobWorker(f.store, { heartbeatMs: 10, handlers: { analysis: async (execution) => {
    started = true;
    await new Promise<void>((resolve) => execution.signal.addEventListener("abort", () => resolve(), { once: true }));
    await stoppedBarrier; stopped = true; execution.signal.throwIfAborted();
    return { output: { kind: "analysis", id: "unreachable" } };
  } } });
  try {
    const first = f.store.enqueue(ctx, request()).job; worker.tick(); await waitFor(() => started);
    f.store.enqueue(ctx, request("second")); f.store.cancel(ctx, first.id);
    await delay(30); assert.equal(f.store.get(ctx, first.id).state, "running"); assert.equal(worker.tick(), 0); assert.equal(stopped, false);
    release(); await worker.drain(); assert.equal(stopped, true); assert.equal(f.store.get(ctx, first.id).state, "cancelled");
    assert.equal(f.store.claim("replacement")?.attempt, 1);
  } finally { release(); await worker.stop(); await f.cleanup(); }
});

test("worker retries only explicit safe transient handler failures and redacts unexpected failures", async () => {
  const f = await fixture(); let calls = 0;
  const worker = new JobWorker(f.store, { heartbeatMs: 20, handlers: { analysis: async () => {
    calls++; if (calls === 1) throw new HandlerFailure("TOOL_BUSY", "Tool is temporarily busy.", true);
    throw new Error("private-key-and-private-path");
  } } });
  try {
    const job = f.store.enqueue(ctx, { ...request(), retry: { safeToRetry: true, maxAttempts: 2 } }).job;
    worker.tick(); await worker.drain(); assert.equal(f.store.get(ctx, job.id).state, "pending");
    await delay(3); worker.tick(); await worker.drain();
    const done = f.store.get(ctx, job.id); assert.equal(done.state, "failed"); assert.equal(done.attempt, 2);
    assert.equal(done.error?.message, "The job could not be completed.");
    assert.equal(JSON.stringify(f.store.events(ctx, job.id)).includes("private-key"), false);
  } finally { await worker.stop(); await f.cleanup(); }
});

test("replacement worker conservatively recovers a lease which expires after startup", async () => {
  const f = await fixture(); let calls = 0;
  const shutdown = new AbortController();
  const job = f.store.enqueue(ctx, { ...request(), retry: { safeToRetry: true, maxAttempts: 2 } }).job;
  f.store.claim("interrupted-worker"); // No handler/process was started for this fixture's old claim.
  const worker = new JobWorker(f.store, {
    pollMs: 5, heartbeatMs: 20,
    verifyInterruptedExecutionStopped: async () => true,
    handlers: { analysis: async () => { calls++; return { output: { kind: "analysis", id: "recovered-result" } }; } },
  });
  const running = worker.run(shutdown.signal);
  try {
    await waitFor(() => f.store.get(ctx, job.id).state === "succeeded");
    assert.equal(calls, 1); assert.equal(f.store.get(ctx, job.id).attempt, 2);
  } finally { shutdown.abort(); await running; await f.cleanup(); }
});

test("execution runtime budget aborts the handler and reaches a stable permanent failure", async () => {
  const f = await fixture();
  const store = new JobStore({ ...f.options, limits: { ...f.options.limits, maxRuntimeMs: 20 } });
  const worker = new JobWorker(store, { heartbeatMs: 5, handlers: { analysis: async (execution) => {
    await new Promise<void>((resolve) => execution.signal.addEventListener("abort", () => resolve(), { once: true }));
    execution.signal.throwIfAborted(); return { output: { kind: "analysis", id: "never" } };
  } } });
  try {
    const job = store.enqueue(ctx, request()).job; worker.tick(); await worker.drain();
    assert.equal(store.get(ctx, job.id).state, "failed"); assert.equal(store.get(ctx, job.id).error?.code, "RUNTIME_LIMIT");
  } finally { await worker.stop(); store.close(); await f.cleanup(); }
});

test("isolated cancellation terminates tools and child processes before reporting completion", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const marker = path.join(f.root, "should-not-be-written");
  const grandchild = `process.on('SIGTERM',()=>{});setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'alive'),300);setInterval(()=>{},1000)`;
  const script = `process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});console.log('started');setInterval(()=>{},1000)`;
  try {
    const running = runIsolatedProcess({ command: process.execPath, args: ["-e", script], signal: controller.signal, terminateGraceMs: 20, onLine: (line) => { if (line === "started") controller.abort(); } });
    await assert.rejects(running); await delay(350);
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally { controller.abort(); await f.cleanup(); }
});
