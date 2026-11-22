import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { CloudJobWorker, cleanCloudScratch } from "../src/cloud-worker.ts";
import type { FinishResult, PostgresJobStore } from "../src/postgres-store.ts";
import { DEFAULT_LIMITS, type Claim } from "../src/types.ts";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const claim = { id: "fixture-job", ownerId: "fixture-owner", projectId: "fixture-project", kind: "analysis", attempt: 1, lease: { token: "fixture-token", workerId: "fixture-worker", expiresAt: Date.now() + 1000 } } as Claim;
async function fixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-cloud-worker-unit-"));
  const finishes: FinishResult[] = [];
  let claimed = false, pulses = 0;
  const store = {
    artifactRoot: root, limits: { ...DEFAULT_LIMITS, leaseMs: 200 },
    workerSeen: async () => {},
    claim: async () => { if (claimed) return null; claimed = true; return claim; },
    workspace: () => path.join(root, claim.id, "attempt-1"),
    trackWorkspace: async () => {},
    heartbeat: async () => { pulses++; return { cancelRequested: false, runtimeExceeded: false }; },
    finish: async (_claim: Claim, result: FinishResult) => { finishes.push(result); },
    ...overrides,
  } as unknown as PostgresJobStore;
  return { store, finishes, pulses: () => pulses, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("shutdown waits for an outstanding claim and never starts its handler", async () => {
  const entered = deferred(), answer = deferred<Claim | null>();
  const f = await fixture({ claim: async () => { entered.resolve(); return answer.promise; } });
  let handlers = 0, stopped = false;
  const worker = new CloudJobWorker(f.store, { handlers: { analysis: async () => { handlers++; return { output: { kind: "analysis", id: "fixture-result" } }; } } });
  try {
    const ticking = worker.tick(); await entered.promise;
    const stopping = worker.stop().then(() => { stopped = true; });
    await delay(5); assert.equal(stopped, false);
    answer.resolve(claim); await ticking; await stopping;
    assert.equal(handlers, 0); assert.equal(worker.activeCount, 0);
    assert.equal(f.finishes.length, 1);
    assert.ok("error" in f.finishes[0]);
    assert.equal(f.finishes[0].error.code, "WORKER_INTERRUPTED");
    assert.equal(await worker.tick(), 0);
  } finally { answer.resolve(null); await worker.stop(); await f.cleanup(); }
});

test("shutdown during the worker heartbeat prevents a later claim", async () => {
  const entered = deferred(), release = deferred(); let claims = 0;
  const f = await fixture({ workerSeen: async () => { entered.resolve(); await release.promise; }, claim: async () => { claims++; return null; } });
  const worker = new CloudJobWorker(f.store, { handlers: { analysis: async () => ({ output: { kind: "analysis", id: "unused" } }) } });
  try {
    const ticking = worker.tick(); await entered.promise; const stopping = worker.stop();
    release.resolve(); assert.equal(await ticking, 0); await stopping; assert.equal(claims, 0);
  } finally { release.resolve(); await worker.stop(); await f.cleanup(); }
});

test("concurrent scheduler passes share one awaited claim", async () => {
  const entered = deferred(), release = deferred(); let claims = 0;
  const f = await fixture({ claim: async () => { claims++; entered.resolve(); await release.promise; return null; } });
  const worker = new CloudJobWorker(f.store, { handlers: { analysis: async () => ({ output: { kind: "analysis", id: "unused" } }) } });
  try {
    const first = worker.tick(); await entered.promise; const second = worker.tick();
    assert.equal(first, second); release.resolve(); await Promise.all([first, second]); assert.equal(claims, 1);
  } finally { release.resolve(); await worker.stop(); await f.cleanup(); }
});

test("shutdown retains lease heartbeats until handler cleanup has settled", async () => {
  const entered = deferred(), aborted = deferred(), release = deferred();
  const f = await fixture();
  const worker = new CloudJobWorker(f.store, { heartbeatMs: 10, handlers: { analysis: async context => {
    entered.resolve();
    await new Promise<void>(done => context.signal.addEventListener("abort", () => { aborted.resolve(); done(); }, { once: true }));
    await release.promise; context.signal.throwIfAborted();
    return { output: { kind: "analysis", id: "unreachable" } };
  } } });
  try {
    await worker.tick(); await entered.promise; const stopping = worker.stop(); await aborted.promise;
    const before = f.pulses(); await delay(35);
    assert.ok(f.pulses() > before); assert.equal(f.finishes.length, 0); assert.equal(worker.activeCount, 1);
    release.resolve(); await stopping; assert.equal(f.finishes.length, 1);
    const record = JSON.parse(await readFile(path.join(f.store.workspace(claim), "worker.json"), "utf8"));
    assert.ok(record.stoppedAt); assert.equal(record.token, claim.lease.token);
  } finally { release.resolve(); await worker.stop(); await f.cleanup(); }
});

test("cloud scratch expiry removes exact registered attempts and refuses symlink traversal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-cloud-retention-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "unfold-cloud-outside-"));
  const forgotten: string[] = [];
  try {
    await mkdir(path.join(root, "valid", "attempt-1"), { recursive: true });
    await writeFile(path.join(outside, "private.txt"), "preserve");
    await symlink(outside, path.join(root, "valid", "attempt-1", "nested"));
    await mkdir(path.join(root, "linked")); await symlink(outside, path.join(root, "linked", "attempt-1"));
    await symlink(outside, path.join(root, "parent"));
    const result = await cleanCloudScratch({ artifactRoot: root, retentionCandidates: async () => [
      { jobId: "valid", attempt: 1, relativePath: "valid/attempt-1" },
      { jobId: "missing", attempt: 1, relativePath: "missing/attempt-1" },
      { jobId: "linked", attempt: 1, relativePath: "linked/attempt-1" },
      { jobId: "parent", attempt: 1, relativePath: "parent/attempt-1" },
      { jobId: "valid", attempt: 1, relativePath: "../outside" },
    ], forgetResource: async (id: string) => { forgotten.push(id); } });
    assert.deepEqual(result, { removed: 2, skipped: 3 }); assert.deepEqual(forgotten, ["valid", "missing"]);
    assert.equal(await readFile(path.join(outside, "private.txt"), "utf8"), "preserve");
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
