import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JobStore, loadJobConfig } from "@unfold/jobs";
import { PrivateStorage } from "./private-storage.ts";
import { createJobsApi, jobApiError } from "./jobs.ts";
import { sourceLoader } from "./test-loader.mjs";
import { createPublishingRuntime } from "./publishing/runtime.ts";
import { PublishingError } from "../../../../services/publishing/src/types.ts";

const A = { id: "delete-owner-a" }, B = { id: "delete-owner-b" };
async function fixture(t, { drainTimeout, mediaJobs = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-project-delete-"));
  const storage = new PrivateStorage(path.join(root, "private-v1"));
  const queue = new JobStore(loadJobConfig({ UNFOLD_DATA_DIR: root, UNFOLD_JOBS_MIN_FREE_BYTES: "1", UNFOLD_BROWSER_EXECUTABLE: process.execPath }));
  const network = t.mock.method(globalThis, "fetch", () => assert.fail("Project deletion must not call a provider"));
  const publishing = createPublishingRuntime(root, { UNFOLD_DATA_DIR: root });
  t.after(async () => { assert.equal(network.mock.callCount(), 0); queue.close(); publishing.store.close(); await rm(root, { recursive: true, force: true }); });
  for (const [owner, projectId] of [[A, "delete-project-a"], [B, "delete-project-b"]]) {
    await storage.createProject(owner, projectId, "Private project");
    await storage.addAsset(owner, projectId, { assetId: projectId, videoId: projectId, projectId, primaryVideoId: projectId, role: "primary", filename: "clip.mp4", extension: ".mp4", description: "", status: "uploaded", createdAt: 1 });
    const { upload } = await storage.assetPaths(owner, projectId);
    await mkdir(path.dirname(upload), { recursive: true });
    await writeFile(upload, "Private fixture source; no media execution");
  }
  const api = createJobsApi({ storage, queue, loadPlan: async () => assert.fail("No plan lookup needed"), prepareRender: async () => assert.fail("No media execution needed") });
  const a = mediaJobs ? (await api.enqueue(A, { kind: "analysis", videoId: "delete-project-a", idempotencyKey: "delete-owner-a-intent" })).job : null;
  const b = mediaJobs ? (await api.enqueue(B, { kind: "analysis", videoId: "delete-project-b", idempotencyKey: "delete-owner-b-intent" })).job : null;
  let user = A;
  let drains = 0, publisherLoads = 0, finalizations = 0;
  const load = sourceLoader({
    "@/lib/auth/server": { requireUser: async () => user },
    "@/server/store": { storage },
    "@/server/jobs": { jobApiError, getJobsApi: async () => ({ drainProject: async (owner, projectId, ids) => { drains++; return api.drainProject(owner, projectId, ids, drainTimeout); } }) },
    "@/server/publishing/runtime": { getPublishingRuntime: () => {
      publisherLoads++;
      return { ...publishing, finalizeProjectDeletion: async (owner, projectId) => {
        await assert.rejects(storage.getProject(owner, projectId), (error) => error.status === 404);
        await publishing.finalizeProjectDeletion(owner, projectId); finalizations++;
      } };
    } },
    "../../../../../../../services/publishing/src/types.ts": { PublishingError },
  });
  const { DELETE } = load("../app/api/projects/[id]/route.ts");
  const remove = (projectId = "delete-project-a") => DELETE(new Request(`https://unfold.invalid/api/projects/${projectId}`, { method: "DELETE" }), { params: Promise.resolve({ id: projectId }) });
  return { storage, queue, publishing, a, b, remove, drains: () => drains, publisherLoads: () => publisherLoads, finalizations: () => finalizations, setUser: (value) => { user = value; } };
}

function publication(f, { draft = false, owner = A, projectId = "delete-project-a", key = "publication-fixture" } = {}) {
  const store = f.publishing.store, accountId = `account-${owner.id}`;
  store.putAccount({ id: accountId, ownerId: owner.id, platform: "instagram", providerAccountId: `ca_${owner.id}`, providerUserId: "fixture-user", authConfigId: "ac_fixture", status: "connected", identity: { id: "123", handle: "fixture", name: "Fixture" }, requestedScopes: [], verifiedAt: 1, createdAt: 1 });
  const media = { ref: { projectId, fileKey: "fixture.mp4" }, mediaContentSha256: "a".repeat(64), properties: { bytes: 1000, duration: 2, width: 720, height: 1280, fps: 30, mime: "video/mp4", videoCodec: "h264", audioCodec: null }, previewUrl: `/media/${projectId}/exports/fixture.mp4` };
  return store.create(owner, media, [{ accountId, platform: "instagram", text: "Deletion fixture", instagram: { shareToFeed: false, thumbnailMs: 0 } }], { mode: "now", at: Date.now() - 1, localDateTime: "", timeZone: "UTC", offsetMinutes: 0 }, key, draft);
}

test("actual project DELETE drains a pending owned SQLite job and preserves a foreign project/job", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const contextA = { ownerId: A.id, projectId: "delete-project-a" };
  const contextB = { ownerId: B.id, projectId: "delete-project-b" };
  f.setUser(B);
  assert.equal((await f.remove()).status, 404);
  assert.equal(f.drains(), 0);
  assert.equal(f.publisherLoads(), 0);
  assert.equal(f.queue.get(contextA, f.a.id).state, "pending");
  f.setUser(A);
  const response = await f.remove();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, true);
  assert.equal(f.drains(), 1);
  assert.equal(f.finalizations(), 1);
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
  const f = await fixture(t, { drainTimeout: 1 });
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

test("unconfigured publishing does not prevent deleting a project with no media jobs", async (t) => {
  const f = await fixture(t, { mediaJobs: false });
  assert.equal(f.publishing.config.apiKey, null);
  assert.equal(f.publishing.config.publicOrigin, null);
  assert.equal(f.publishing.config.enabled, false);
  assert.equal(f.publishing.config.deliveryEnabled, false);
  assert.equal((await f.remove()).status, 200);
  assert.equal(f.publisherLoads(), 1);
  assert.equal(f.drains(), 0);
  assert.equal(f.finalizations(), 1);
  assert.throws(() => f.publishing.store.assertAdmission(A, "delete-project-a"), (error) => error.code === "DELETION_PENDING");
  await assert.rejects(f.storage.getProject(A, "delete-project-a"), (error) => error.status === 404);
});

test("project deletion cancels drafts and revokes delivery even when storage must wait for active work", async (t) => {
  const f = await fixture(t, { mediaJobs: false });
  const draft = publication(f, { draft: true, key: "pending-draft" });
  const post = publication(f, { key: "delivery-fixture" });
  const claim = f.publishing.store.claim();
  const grant = f.publishing.store.issueDelivery(claim.destination.id, claim.token, { kind: "video", fileKey: post.export.ref.fileKey });
  f.publishing.store.release(claim.destination.id, claim.token, { state: "processing" });
  assert.equal(f.publishing.store.delivery(grant.capability).postId, post.id);
  const release = await f.storage.acquireLease(A, "delete-project-a", "active-export");
  try {
    assert.equal((await f.remove()).status, 409);
    assert.equal(f.finalizations(), 0);
    for (const id of [draft.id, post.id]) assert.equal(f.publishing.store.get(A, id).destinations[0].state, "cancelled");
    assert.throws(() => f.publishing.store.delivery(grant.capability), (error) => error.status === 404);
    assert.throws(() => publication(f, { key: "blocked-draft" }), (error) => error.code === "DELETION_PENDING");
    const { upload } = await f.storage.assetPaths(A, "delete-project-a");
    assert.match(await readFile(upload, "utf8"), /Private fixture source/);
  } finally { await release(); }
  assert.equal((await f.remove()).status, 200);
  assert.equal(f.finalizations(), 1);
  assert.equal(f.publishing.store.list(A).length, 0);
  assert.throws(() => f.publishing.store.assertAdmission(A, "delete-project-a"), (error) => error.code === "DELETION_PENDING");
});

test("an unresolved publication returns safe 409 and retains the project and media queue", async (t) => {
  const f = await fixture(t);
  const post = publication(f);
  const claim = f.publishing.store.claim();
  const grant = f.publishing.store.issueDelivery(claim.destination.id, claim.token, { kind: "video", fileKey: post.export.ref.fileKey });
  f.publishing.store.reserveOperation(claim.destination.id, claim.token, "fixture-publish");
  const response = await f.remove();
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "PUBLICATION_UNRESOLVED");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(`${claim.destination.id}|${grant.capability}`));
  assert.equal(f.drains(), 0);
  assert.equal(f.finalizations(), 0);
  assert.equal(f.queue.get({ ownerId: A.id, projectId: "delete-project-a" }, f.a.id).state, "pending");
  const { upload } = await f.storage.assetPaths(A, "delete-project-a");
  assert.match(await readFile(upload, "utf8"), /Private fixture source/);
  assert.throws(() => f.publishing.store.delivery(grant.capability), (error) => error.status === 404);
  assert.throws(() => f.publishing.store.assertAdmission(A, "delete-project-a"), (error) => error.code === "DELETION_PENDING");
  assert.doesNotThrow(() => f.publishing.store.assertAdmission(B, "delete-project-b"));
});

test("foreign project deletion cannot close admission, cancel a draft or revoke its delivery grant", async (t) => {
  const f = await fixture(t);
  const draft = publication(f, { draft: true, key: "foreign-draft" });
  const post = publication(f, { key: "foreign-delivery" });
  const claim = f.publishing.store.claim();
  const grant = f.publishing.store.issueDelivery(claim.destination.id, claim.token, { kind: "video", fileKey: post.export.ref.fileKey });
  f.setUser(B);
  assert.equal((await f.remove()).status, 404);
  assert.equal(f.publisherLoads(), 0);
  assert.equal(f.finalizations(), 0);
  assert.doesNotThrow(() => f.publishing.store.assertAdmission(A, "delete-project-a"));
  assert.equal(f.publishing.store.get(A, draft.id).destinations[0].state, "draft");
  assert.equal(f.publishing.store.delivery(grant.capability).postId, post.id);
  assert.equal(f.queue.get({ ownerId: A.id, projectId: "delete-project-a" }, f.a.id).state, "pending");
  assert.equal((await f.storage.getProject(A, "delete-project-a")).ownerId, A.id);
});
