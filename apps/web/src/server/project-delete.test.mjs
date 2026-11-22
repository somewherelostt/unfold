import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JobStore, loadJobConfig } from "@unfold/jobs";
import { PrivateStorage } from "./private-storage.ts";
import { createJobsApi, jobApiError } from "./jobs.ts";
import { sourceLoader } from "./test-loader.mjs";

const A = { id: "delete-owner-a" }, B = { id: "delete-owner-b" };
async function fixture(t, drainTimeout) {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-project-delete-"));
  const storage = new PrivateStorage(path.join(root, "private-v1"));
  const queue = new JobStore(loadJobConfig({ UNFOLD_DATA_DIR: root, UNFOLD_JOBS_MIN_FREE_BYTES: "1", UNFOLD_BROWSER_EXECUTABLE: process.execPath }));
  t.after(async () => { queue.close(); await rm(root, { recursive: true, force: true }); });
  for (const [owner, projectId] of [[A, "delete-project-a"], [B, "delete-project-b"]]) {
    await storage.createProject(owner, projectId, "Private project");
    await storage.addAsset(owner, projectId, { assetId: projectId, videoId: projectId, projectId, primaryVideoId: projectId, role: "primary", filename: "clip.mp4", extension: ".mp4", description: "", status: "uploaded", createdAt: 1 });
    const { upload } = await storage.assetPaths(owner, projectId);
    await mkdir(path.dirname(upload), { recursive: true });
    await writeFile(upload, "Private fixture source; no media execution");
  }
  const api = createJobsApi({ storage, queue, loadPlan: async () => assert.fail("No plan lookup needed"), prepareRender: async () => assert.fail("No media execution needed") });
  const a = (await api.enqueue(A, { kind: "analysis", videoId: "delete-project-a", idempotencyKey: "delete-owner-a-intent" })).job;
  const b = (await api.enqueue(B, { kind: "analysis", videoId: "delete-project-b", idempotencyKey: "delete-owner-b-intent" })).job;
  let user = A;
  let drains = 0;
  const load = sourceLoader({
    "@/lib/auth/server": { requireUser: async () => user },
    "@/server/store": { storage },
    "@/server/jobs": { jobApiError, getJobsApi: async () => ({ drainProject: async (owner, projectId, ids) => { drains++; return api.drainProject(owner, projectId, ids, drainTimeout); } }) },
  });
  const { DELETE } = load("../app/api/projects/[id]/route.ts");
  const remove = (projectId = "delete-project-a") => DELETE(new Request(`https://unfold.invalid/api/projects/${projectId}`, { method: "DELETE" }), { params: Promise.resolve({ id: projectId }) });
  return { storage, queue, a, b, remove, drains: () => drains, setUser: (value) => { user = value; } };
}

test("actual project DELETE drains a pending owned SQLite job and preserves a foreign project/job", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const contextA = { ownerId: A.id, projectId: "delete-project-a" };
  const contextB = { ownerId: B.id, projectId: "delete-project-b" };
  f.setUser(B);
  assert.equal((await f.remove()).status, 404);
  assert.equal(f.drains(), 0);
  assert.equal(f.queue.get(contextA, f.a.id).state, "pending");
  f.setUser(A);
  const response = await f.remove();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, true);
  assert.equal(f.drains(), 1);
  assert.equal(f.queue.get(contextA, f.a.id).state, "cancelled");
  await assert.rejects(f.storage.getProject(A, "delete-project-a"), (error) => error.status === 404);
  assert.equal((await f.storage.getProject(B, "delete-project-b")).ownerId, B.id);
  assert.equal(f.queue.get(contextB, f.b.id).state, "pending");
});

test("project DELETE still preserves files while non-job work holds an active lease", async (t) => {
  const f = await fixture(t);
  const release = await f.storage.acquireLease(A, "delete-project-a", "active-export");
  try {
    const response = await f.remove();
    assert.equal(response.status, 409);
    assert.equal(f.queue.get({ ownerId: A.id, projectId: "delete-project-a" }, f.a.id).state, "cancelled");
    const { upload } = await f.storage.assetPaths(A, "delete-project-a");
    assert.match(await readFile(upload, "utf8"), /Private fixture source/);
  } finally { await release(); }
  assert.equal((await f.remove()).status, 200);
});

test("project DELETE maps a still-running queue drain to safe 409 and retains its source", async (t) => {
  const f = await fixture(t, 1);
  const claim = f.queue.claim("fixture-running-worker", ["analysis"]);
  assert.equal(claim.id, f.a.id);
  const response = await f.remove();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "JOBS_DRAINING");
  const running = f.queue.get({ ownerId: A.id, projectId: "delete-project-a" }, f.a.id);
  assert.equal(running.state, "running");
  assert.ok(running.cancelRequestedAt);
  assert.equal((await f.storage.getProject(A, "delete-project-a")).id, "delete-project-a");
  f.queue.finish(claim, { cancelled: true });
});
