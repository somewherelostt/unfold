import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadJobConfig } from "../src/config.ts";
import { checkReadiness } from "../src/health.ts";
import { JobStore } from "../src/store.ts";
import { runIsolatedProcess, verifyRecordedExecutionStopped } from "../src/process.ts";

test("configuration bounds limits and rejects unsafe runtime paths without copying credentials", async () => {
  const config = loadJobConfig({ UNFOLD_DATA_DIR: "/tmp/jobs-config", OPENCLAW_GATEWAY_TOKEN: "not-returned-in-config" });
  assert.equal(config.gatewayTokenConfigured, true); assert.equal(JSON.stringify(config).includes("not-returned-in-config"), false);
  assert.equal(config.limits.maxRenders, 1); assert.equal(config.limits.maxOutstandingPerOwner, 4);
  assert.throws(() => loadJobConfig({ UNFOLD_JOBS_MAX_RENDERS: "0" }));
  assert.throws(() => loadJobConfig({ UNFOLD_DATA_DIR: "relative" }));
  assert.throws(() => loadJobConfig({ OPENCLAW_GATEWAY_URL: "https://token@example.invalid" }));
});

test("readiness checks tools, disk, worker and gateway without inference or credential leakage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-health-test-"));
  let requests = 0; let authHeader: string | undefined;
  const server = createServer((req, res) => { requests++; authHeader = req.headers.authorization; assert.equal(req.url, "/health"); res.end("ok"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const speechModel = path.join(root, "model"); await writeFile(speechModel, "fixture");
  await writeFile(path.join(root, "bindings.ts"), "// Readability fixture only; no handler execution in readiness.");
  const config = loadJobConfig({ UNFOLD_DATA_DIR: root, UNFOLD_JOB_BINDINGS: path.join(root, "bindings.ts"), UNFOLD_BROWSER_EXECUTABLE: process.execPath, UNFOLD_BUN_BIN: process.execPath, FFMPEG_PATH: process.execPath, FFPROBE_PATH: process.execPath, UNFOLD_STT_BIN: process.execPath, UNFOLD_STT_MODEL: speechModel, OPENCLAW_GATEWAY_URL: `http://127.0.0.1:${port}`, OPENCLAW_GATEWAY_TOKEN: "do-not-echo", UNFOLD_JOBS_MIN_FREE_BYTES: "1" });
  const store = new JobStore(config);
  try {
    let result = await checkReadiness(config, store, { requireWorker: true });
    assert.equal(result.ready, false); assert.equal(result.checks.worker.ok, false);
    store.workerSeen("healthy-worker"); result = await checkReadiness(config, store, { requireWorker: true });
    assert.equal(result.ready, true); assert.equal(requests, 2); assert.equal(authHeader, undefined);
    assert.equal(JSON.stringify(result).includes("do-not-echo"), false);
    const missing = await checkReadiness({ ...config, browserExecutable: path.join(root, "missing-browser"), minFreeBytes: Number.MAX_SAFE_INTEGER }, store);
    assert.equal(missing.ready, false); assert.equal(missing.checks.browser.ok, false); assert.equal(missing.checks.disk.ok, false);
  } finally { store.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test("recovery verifies recorded local process identity and refuses missing or mismatched execution records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-process-record-test-"));
  const store = new JobStore({ databasePath: path.join(root, "queue.sqlite"), artifactRoot: path.join(root, "artifacts") });
  try {
    store.enqueue({ ownerId: "owner", projectId: "project" }, { kind: "analysis", input: { kind: "upload", id: "upload" }, idempotencyKey: "process-record-test" });
    const claim = store.claim("worker-record")!;
    const { mkdir } = await import("node:fs/promises"); await mkdir(store.workspace(claim), { recursive: true });
    assert.equal(await verifyRecordedExecutionStopped(store, claim), false);
    const file = path.join(store.workspace(claim), "process.json");
    await runIsolatedProcess({ command: process.execPath, args: ["-e", "process.exit(0)"], signal: new AbortController().signal, record: { file, token: claim.lease.token, workerId: claim.lease.workerId } });
    const workerFile = path.join(store.workspace(claim), "worker.json");
    await writeFile(workerFile, JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: claim.lease.token, workerId: claim.lease.workerId, stoppedAt: null }));
    assert.equal(await verifyRecordedExecutionStopped(store, claim), false); // The old parent is still alive.
    await writeFile(workerFile, JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: claim.lease.token, workerId: claim.lease.workerId, stoppedAt: Date.now() }));
    assert.equal(await verifyRecordedExecutionStopped(store, claim), true);
    await writeFile(workerFile, JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: "different-token", workerId: claim.lease.workerId, stoppedAt: Date.now() }));
    assert.equal(await verifyRecordedExecutionStopped(store, claim), false);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
