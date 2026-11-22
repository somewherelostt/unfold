import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { JobStore } from "../src/store.ts";
import { cleanExpiredResources } from "../src/retention.ts";
import { JobFault, type EnqueueRequest, type JobContext } from "../src/types.ts";

const roots: string[] = [];
const stores: JobStore[] = [];
const alice = { ownerId: "alice", projectId: "project-a" };
const bob = { ownerId: "bob", projectId: "project-b" };
const request = (id = "upload-1", extra: Partial<EnqueueRequest> = {}): EnqueueRequest => ({ kind: "analysis", input: { kind: "upload", id }, idempotencyKey: `click-key-${id}`, ...extra });
async function fixture(limits = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-jobs-test-")); roots.push(root);
  let now = 1_000;
  const options = { databasePath: path.join(root, "jobs.sqlite"), artifactRoot: path.join(root, "artifacts"), limits, now: () => now };
  const store = new JobStore(options); stores.push(store);
  return { root, store, options, time: (n: number) => { now += n; } };
}
function fault(code: string) { return (error: unknown) => error instanceof JobFault && error.code === code; }
afterEach(async () => { for (const store of stores.splice(0)) { try { store.close(); } catch {} } for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("durable state and ordered progress survive reopened store connections", async () => {
  const { store, options } = await fixture();
  const initial = store.enqueue(alice, request()).job;
  const claim = store.claim("worker-one")!;
  store.heartbeat(claim, { fraction: 0.4, stage: "analyzing" });
  const reopened = new JobStore(options); stores.push(reopened);
  assert.equal(reopened.get(alice, initial.id).state, "running");
  reopened.finish(claim, { output: { kind: "analysis", id: "analysis-one" } });
  const again = new JobStore(options); stores.push(again);
  assert.equal(again.get(alice, initial.id).output?.id, "analysis-one");
  const events = again.events(alice, initial.id);
  assert.deepEqual(events.map((e) => e.data.state), ["pending", "running", "running", "succeeded"]);
  assert.ok(events.every((event, i) => !i || event.id > events[i - 1].id));
  assert.equal("lease" in events[0].data, false);
  assert.equal("ownerId" in events[0].data, false);
});

test("two independent processes cannot claim the same execution", async () => {
  const { store, options } = await fixture();
  const id = store.enqueue(alice, request()).job.id;
  const script = fileURLToPath(new URL("./claim-child.ts", import.meta.url));
  const run = (worker: string) => new Promise<string | null>((resolve, reject) => {
    const p = spawn(process.execPath, [script, options.databasePath, options.artifactRoot, worker], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    p.stdout.on("data", (b) => { stdout += b; }); p.stderr.on("data", (b) => { stderr += b; });
    p.on("error", reject); p.on("close", (code) => code === 0 ? resolve(JSON.parse(stdout).id) : reject(new Error(stderr)));
  });
  const results = await Promise.all([run("worker-a"), run("worker-b")]);
  assert.equal(results.filter((value) => value === id).length, 1);
  assert.equal(results.filter((value) => value === null).length, 1);
});

test("status, events, cancellation and output release are owner AND project scoped", async () => {
  const { store } = await fixture();
  const id = store.enqueue(alice, request()).job.id;
  for (const ctx of [bob, { ...alice, projectId: "different-project" }]) {
    assert.throws(() => store.get(ctx, id), fault("NOT_FOUND"));
    assert.throws(() => store.events(ctx, id), fault("NOT_FOUND"));
    assert.throws(() => store.cancel(ctx, id), fault("NOT_FOUND"));
    assert.throws(() => store.releaseOutput(ctx, id), fault("NOT_FOUND"));
  }
  assert.throws(() => store.enqueue({} as JobContext, request()), fault("INVALID_CONTEXT"));
});

test("idempotency is durable, rejects changed payloads, and does not cross owners/projects", async () => {
  const { store, options } = await fixture();
  const original = store.enqueue(alice, request());
  const another = new JobStore(options); stores.push(another);
  assert.deepEqual(another.enqueue(alice, request()), { job: original.job, created: false });
  assert.throws(() => another.enqueue(alice, request("changed", { idempotencyKey: request().idempotencyKey })), fault("IDEMPOTENCY_CONFLICT"));
  assert.notEqual(store.enqueue(bob, request()).job.id, original.job.id);
  assert.notEqual(store.enqueue({ ...alice, projectId: "project-z" }, request()).job.id, original.job.id);
});

test("server-selected IDs support preregistration while scoped reads and collisions remain isolated", async () => {
  const { store } = await fixture();
  const original = store.enqueue(alice, request(), { id: "server-job-one" });
  assert.equal(original.job.id, "server-job-one");
  assert.equal(store.enqueue(alice, request(), { id: "server-job-two" }).job.id, "server-job-one");
  assert.equal(store.getForOwner(alice.ownerId, original.job.id).context.projectId, alice.projectId);
  assert.throws(() => store.getForOwner(bob.ownerId, original.job.id), fault("NOT_FOUND"));
  assert.throws(() => store.getForOwner(alice.ownerId, "missing"), fault("NOT_FOUND"));
  assert.throws(() => store.enqueue(bob, request(), { id: "server-job-one" }));
  assert.equal(store.getForOwner(alice.ownerId, original.job.id).job.state, "pending");
});

test("limits apply atomically across connections and owner consumption spans projects", async () => {
  const { store, options } = await fixture({ maxOutstandingPerOwner: 1, maxQueued: 2 });
  const other = new JobStore(options); stores.push(other);
  store.enqueue(alice, request());
  assert.throws(() => other.enqueue({ ...alice, projectId: "project-z" }, request("another")), fault("OWNER_LIMIT"));
  other.enqueue(bob, request());
  assert.throws(() => store.enqueue({ ownerId: "charlie", projectId: "p" }, request()), fault("QUEUE_FULL"));
  const claim = store.claim("worker-one")!;
  store.cancel({ ownerId: claim.ownerId, projectId: claim.projectId }, claim.id);
  assert.equal(store.claim("worker-two"), null); // default maxAnalysis=1, including cancelling work
  store.finish(claim, { cancelled: true });
  assert.ok(other.claim("worker-two"));
});

test("render concurrency is independently bounded while another owner can analyze", async () => {
  const { store } = await fixture();
  const render = (id: string): EnqueueRequest => request(id, { kind: "render", input: { kind: "plan", id, revision: "sha-one" } });
  store.enqueue(alice, render("plan-one")); store.enqueue(bob, render("plan-two"));
  const first = store.claim("worker-one", ["render"])!;
  assert.ok(first); assert.equal(store.claim("worker-two", ["render"]), null);
  const third = { ownerId: "charlie", projectId: "p3" };
  store.enqueue(third, request("third")); assert.equal(store.claim("worker-two", ["analysis"])?.ownerId, third.ownerId);
});

test("pending cancellation is terminal and running cancellation waits for stop acknowledgement", async () => {
  const { store } = await fixture();
  const queued = store.enqueue(alice, request()).job;
  assert.equal(store.cancel(alice, queued.id).state, "cancelled");
  assert.equal(store.claim("worker-one"), null);
  const running = store.enqueue(alice, request("second")).job;
  const claim = store.claim("worker-one")!;
  assert.equal(store.cancel(alice, running.id).state, "running");
  assert.equal(store.heartbeat(claim).cancelRequested, true);
  const final = store.finish(claim, { output: { kind: "analysis", id: "late-output" } });
  assert.equal(final.state, "cancelled"); assert.equal(final.output, null);
  assert.deepEqual(store.cancel(alice, running.id), final);
  assert.throws(() => store.finish(claim, { cancelled: true }), fault("LEASE_LOST"));
});

test("only explicitly safe transient failures retry with bounded exponential delay", async () => {
  const { store, time } = await fixture({ retryBaseMs: 10 });
  const job = store.enqueue(alice, request("retry", { retry: { safeToRetry: true, maxAttempts: 3 } })).job;
  let claim = store.claim("worker-one")!;
  assert.equal(store.finish(claim, { error: { code: "BUSY", message: "Tool is temporarily unavailable.", transient: true } }).state, "pending");
  assert.equal(store.claim("worker-two"), null); time(10);
  claim = store.claim("worker-two")!; assert.equal(claim.attempt, 2);
  store.finish(claim, { error: { code: "BUSY", message: "Busy.", transient: true } });
  time(19); assert.equal(store.claim("worker-three"), null); time(1);
  claim = store.claim("worker-three")!;
  assert.equal(store.finish(claim, { error: { code: "BUSY", message: "Busy.", transient: true } }).state, "failed");
  assert.equal(store.get(alice, job.id).attempt, 3);
  store.enqueue(alice, request("permanent", { retry: { safeToRetry: true, maxAttempts: 3 } }));
  claim = store.claim("worker-one")!;
  assert.equal(store.finish(claim, { error: { code: "INVALID_MEDIA", message: "Unsupported media.", transient: false } }).state, "failed");
});

test("expired leases never permit blind duplicate execution, recovery fences the previous attempt", async () => {
  const { store, time } = await fixture({ leaseMs: 20, retryBaseMs: 1 });
  const id = store.enqueue(alice, request("recover", { retry: { safeToRetry: true, maxAttempts: 2 } })).job.id;
  const old = store.claim("worker-old")!; time(21);
  assert.equal(store.claim("worker-new"), null);
  assert.throws(() => store.heartbeat(old), fault("LEASE_EXPIRED"));
  assert.equal(await store.recoverExpired(async () => false), 0);
  assert.equal(store.get(alice, id).state, "running");
  assert.equal(await store.recoverExpired(async () => true), 1); time(1);
  const next = store.claim("worker-new")!;
  assert.notEqual(next.lease.token, old.lease.token);
  assert.throws(() => store.finish(old, { output: { kind: "analysis", id: "stale" } }), fault("LEASE_LOST"));
  store.finish(next, { output: { kind: "analysis", id: "fresh" } });
  assert.equal(store.get(alice, id).output?.id, "fresh");
});

test("unsafe interrupted work fails once, while unverifiable expired work keeps capacity", async () => {
  const { store, time } = await fixture({ leaseMs: 20 });
  store.enqueue(alice, request()); const first = store.claim("worker-one")!; time(21);
  assert.equal(await store.recoverExpired(async () => true), 1);
  assert.equal(store.get(alice, first.id).state, "failed");
  store.enqueue(alice, request("second")); const second = store.claim("worker-two")!; time(21);
  assert.equal(await store.recoverExpired(async () => { /* A stale candidate can no longer renew, so stop it. */ return false; }), 0);
  assert.equal(store.get(alice, second.id).state, "running");
});

test("strict reference payloads cannot persist keys, paths, URLs or missing identifiers", async () => {
  const { store } = await fixture();
  assert.throws(() => store.enqueue(alice, { ...request(), apiKey: "secret" } as EnqueueRequest), fault("INVALID_REQUEST"));
  assert.throws(() => store.enqueue(alice, { ...request(), input: { ...request().input, path: "/etc/passwd" } } as EnqueueRequest), fault("INVALID_REQUEST"));
  assert.throws(() => store.enqueue(alice, { ...request(), input: { kind: "upload" } } as EnqueueRequest), fault("INVALID_REQUEST"));
  assert.throws(() => store.enqueue(alice, request("plan", { kind: "render", input: { kind: "plan", id: "plan" } })), fault("INVALID_REQUEST"));
  assert.throws(() => store.enqueue(alice, request("unsafe", { retry: { maxAttempts: 2, safeToRetry: false } })), fault("INVALID_REQUEST"));
});

test("retention preserves active jobs, referenced output, user media and symlinked paths", async () => {
  const { store, root, time } = await fixture({ maxAnalysis: 3, maxRunning: 3 });
  const source = path.join(root, "source.mp4"); await writeFile(source, "user media");
  const setup = async (ctx: JobContext, id: string) => {
    store.enqueue(ctx, request(id)); const claim = store.claim(`worker-${id}`)!;
    store.trackWorkspace(claim, 10); await mkdir(store.workspace(claim), { recursive: true });
    await writeFile(path.join(store.workspace(claim), "output"), id); return claim;
  };
  const active = await setup(alice, "active");
  const retained = await setup(bob, "retained");
  store.finish(retained, { output: { kind: "analysis", id: "result" }, retainWorkspace: true });
  const expired = await setup({ ownerId: "c", projectId: "p" }, "expired");
  store.finish(expired, { error: { code: "FAIL", message: "Failed.", transient: false } }); time(11);
  assert.deepEqual(await cleanExpiredResources(store), { removed: 1, skipped: 0 });
  assert.equal(await readFile(source, "utf8"), "user media");
  assert.equal(await readFile(path.join(store.workspace(active), "output"), "utf8"), "active");
  assert.equal(await readFile(path.join(store.workspace(retained), "output"), "utf8"), "retained");
  store.releaseOutput(bob, retained.id);
  await rm(store.workspace(retained), { recursive: true });
  await symlink(path.dirname(source), store.workspace(retained), "dir");
  assert.deepEqual(await cleanExpiredResources(store), { removed: 0, skipped: 1 });
  assert.equal(await readFile(source, "utf8"), "user media");
});

test("account teardown cancels only that owner's jobs and signals when draining is complete", async () => {
  const { store } = await fixture();
  const a = store.enqueue(alice, request()).job;
  const b = store.enqueue(bob, request()).job;
  const claim = store.claim("worker-one")!;
  const owner = claim.ownerId; const other = owner === alice.ownerId ? bob : alice;
  assert.equal(store.cancelOwner(owner), 1);
  assert.equal(store.ownerHasLiveWork(owner), true);
  store.finish(claim, { cancelled: true });
  assert.equal(store.ownerHasLiveWork(owner), false);
  assert.equal(store.get(other, other === alice ? a.id : b.id).state, "pending");
});
