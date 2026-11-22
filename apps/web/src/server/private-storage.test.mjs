import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { sourceLoader } from "./test-loader.mjs";

const A = { id: "user-a" }, B = { id: "user-b" };
const load = sourceLoader();
const { PrivateStorage } = load("./private-storage.ts");
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-private-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new PrivateStorage(root);
  for (const [owner, projectId] of [[A, "project-a"], [B, "project-b"]]) {
    await storage.createProject(owner, projectId, "Private clip");
    const asset = { assetId: projectId, videoId: projectId, projectId, primaryVideoId: projectId, role: "primary", description: "", filename: "clip.mp4", extension: ".mp4", status: "analyzed", createdAt: 1 };
    await storage.addAsset(owner, projectId, asset);
    const dir = path.join(storage.projectDir(projectId), "media", projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "source.mp4"), "0123456789");
    await writeFile(path.join(dir, "analysis.json"), "{}");
    await storage.putRecord(owner, projectId, "plans", `plan-${owner.id}`, { revision: 1, updatedAt: 1, editPlan: { supporting: [] } });
  }
  return { storage, root };
}
const forbidden = (promise) => assert.rejects(promise, (error) => error.status === 404);

test("two owners cannot read each other's projects, assets, plans, media, or delete them", async (t) => {
  const { storage } = await fixture(t);
  await forbidden(storage.getProject(A, "project-b"));
  await forbidden(storage.getAsset(A, "project-b"));
  await forbidden(storage.getRecord(A, "plans", "plan-user-b"));
  await forbidden(storage.mediaPath(A, ["project-b", "project-b", "analysis.json"]));
  await forbidden(storage.deleteProject(A, "project-b"));
  assert.deepEqual(Array.from(await storage.listProjects(A), (project) => project.id), ["project-a"]);
  assert.equal((await storage.getProject(B, "project-b")).ownerId, B.id);
});

test("supporting IDs cannot cross projects or owners and referenced assets cannot be deleted", async (t) => {
  const { storage } = await fixture(t);
  const asset = { assetId: "support-b", videoId: "support-b", projectId: "project-b", primaryVideoId: "project-b", role: "supporting", description: "proof", filename: "detail.mp4", extension: ".mp4", status: "uploaded", createdAt: 1 };
  await storage.addAsset(B, "project-b", asset);
  await forbidden(storage.getAsset(A, "support-b"));
  await forbidden(storage.updateAsset(A, "project-b", "support-b", { description: "stolen" }));
  await forbidden(storage.deleteAsset(A, "project-b", "support-b"));
  await storage.putRecord(B, "project-b", "plans", "support-plan", { editPlan: { supporting: [{ videoId: "support-b" }] } });
  await assert.rejects(storage.deleteAsset(B, "project-b", "support-b"), (error) => error.status === 409);
});

test("unused supporting uploads can be removed without touching primary or unrelated files", async (t) => {
  const { storage } = await fixture(t);
  await storage.addAsset(A, "project-a", { assetId: "unused", videoId: "unused", projectId: "project-a", primaryVideoId: "project-a", role: "supporting", description: "", filename: "unused.mp4", extension: ".mp4", status: "uploaded", createdAt: 1 });
  assert.equal((await storage.deleteAsset(A, "project-a", "unused")).deleted, true);
  await forbidden(storage.getAsset(A, "unused"));
  assert.equal((await storage.getAsset(A, "project-a")).role, "primary");
});

test("plan saves use atomic revisions and preserve the winner under concurrent writes", async (t) => {
  const { storage } = await fixture(t);
  const saves = await Promise.allSettled(["first", "second"].map((title) => storage.reviseRecord(A, "project-a", "plan-user-a", 1, async (current) => ({ ...current, title }))));
  assert.equal(saves.filter((item) => item.status === "fulfilled").length, 1);
  const failure = saves.find((item) => item.status === "rejected");
  assert.equal(failure.reason.status, 409);
  assert.equal(failure.reason.currentRevision, 2);
  const saved = await storage.getRecord(A, "plans", "plan-user-a");
  assert.equal(saved.value.revision, 2);
  assert.ok(["first", "second"].includes(saved.value.title));
});

test("project records survive a fresh process", async (t) => {
  const { root } = await fixture(t);
  const loader = fileURLToPath(new URL("./test-loader.mjs", import.meta.url));
  const script = `import {sourceLoader} from ${JSON.stringify(`file://${loader}`)};const {PrivateStorage}=sourceLoader()('./private-storage.ts');const s=new PrivateStorage(${JSON.stringify(root)});console.log(JSON.stringify((await s.getRecord({id:'user-a'},'plans','plan-user-a')).value));`;
  const value = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));
  assert.equal(value.revision, 1);
});

test("renderer capabilities are exact-file, owner/project scoped, expiring and revoked on release", async (t) => {
  const { storage } = await fixture(t);
  const approved = "/media/project-a/project-a/source.mp4";
  const access = await storage.createRenderAccess(A, "project-a", [approved]);
  assert.ok((await storage.renderMediaPath(["project-a", "project-a", "source.mp4"], access.token)).endsWith("source.mp4"));
  await forbidden(storage.renderMediaPath(["project-a", "project-a", "analysis.json"], access.token));
  await forbidden(storage.renderMediaPath(["project-b", "project-b", "source.mp4"], access.token));
  await assert.rejects(storage.deleteProject(A, "project-a"), (error) => error.status === 409);
  await access.release();
  await forbidden(storage.renderMediaPath(["project-a", "project-a", "source.mp4"], access.token));
  const expired = await storage.createRenderAccess(A, "project-a", [approved], 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await forbidden(storage.renderMediaPath(["project-a", "project-a", "source.mp4"], expired.token));
  await expired.release();
});

test("deletion preserves active and unrelated projects and all ownerless legacy data", async (t) => {
  const { storage, root } = await fixture(t);
  const legacy = path.join(root, "legacy-ownerless.json");
  await writeFile(legacy, "legacy");
  const release = await storage.acquireLease(A, "project-a", "analysis");
  await assert.rejects(storage.deleteProject(A, "project-a"), (error) => error.status === 409);
  await release();
  assert.equal((await storage.deleteProject(A, "project-a")).deleted, true);
  await forbidden(storage.getProject(A, "project-a"));
  assert.equal((await storage.getProject(B, "project-b")).id, "project-b");
  assert.equal(await readFile(legacy, "utf8"), "legacy");
  await forbidden(storage.getAsset(A, "legacy-ownerless"));
});

test("paths cannot escape through traversal or a symlink", async (t) => {
  const { storage, root } = await fixture(t);
  await forbidden(storage.mediaPath(A, ["project-a", "project-a", "..", "project.json"]));
  const outside = path.join(root, "not-media.txt");
  await writeFile(outside, "private");
  await symlink(outside, path.join(storage.projectDir("project-a"), "media", "project-a", "escape.txt"));
  await forbidden(storage.mediaPath(A, ["project-a", "project-a", "escape.txt"]));
});

test("actual media handlers enforce ownership before regular and Range responses", async (t) => {
  const { storage } = await fixture(t);
  let user = A;
  const api = sourceLoader({ "@/lib/auth/server": { requireUser: async () => user }, "@/server/store": { storage }, "@/server/api-errors": load("./api-errors.ts") });
  const { GET } = api("../app/media/[...path]/route.ts");
  const context = { params: Promise.resolve({ path: ["project-b", "project-b", "source.mp4"] }) };
  const request = (range) => new Request("https://unfold.invalid/media/project-b/project-b/source.mp4", { headers: range ? { Range: range } : {} });
  assert.equal((await GET(request(), context)).status, 404);
  assert.equal((await GET(request("bytes=0-3"), context)).status, 404);
  user = B;
  const range = await GET(request("bytes=0-3"), context);
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "0123");
  assert.equal(range.headers.get("cache-control"), "private, no-store");
  assert.equal(await (await GET(request("bytes=-3"), context)).text(), "789");
  assert.equal((await GET(request("bytes=0-1,4-5"), context)).status, 416);
});

test("job snapshots are immutable, revision-bound, owner-scoped and independent of saved edits", async (t) => {
  const { storage } = await fixture(t);
  const snapshot = await storage.putJobInput(A, "project-a", "snapshot-a", { title: "Clicked preview" });
  await storage.reviseRecord(A, "project-a", "plan-user-a", 1, async (current) => ({ ...current, title: "New save" }));
  assert.equal((await storage.getJobInput(A, "project-a", "snapshot-a", snapshot.revision)).title, "Clicked preview");
  await forbidden(storage.getJobInput(B, "project-a", "snapshot-a", snapshot.revision));
  await assert.rejects(storage.putJobInput(A, "project-a", "snapshot-a", { title: "Changed" }), (error) => error.status === 409);
  await assert.rejects(storage.getJobInput(A, "project-a", "snapshot-a", "wrong-revision"), (error) => error.status === 409);
  await storage.deleteJobInput(A, "project-a", "snapshot-a");
  await forbidden(storage.getJobInput(A, "project-a", "snapshot-a"));
});

test("completed job references can be released and job drain callbacks do not deadlock deletion", async (t) => {
  const { storage } = await fixture(t);
  await storage.registerReference(A, "project-a", "jobs", "job-a");
  await assert.rejects(storage.deleteProject(A, "project-a"), (error) => error.status === 409);
  const deleted = await storage.deleteProject(A, "project-a", async (ids) => {
    assert.equal(ids[0], "job-a");
    await storage.unregisterJob(A, "project-a", "job-a");
  });
  assert.equal(deleted.deleted, true);
});

test("a dead process lock is recovered before the next atomic metadata update", async (t) => {
  const { storage, root } = await fixture(t);
  const lock = path.join(root, "locks", "project-a");
  await mkdir(lock);
  await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 2147483647 }));
  const asset = await storage.updateAsset(A, "project-a", "project-a", { description: "Recovered" });
  assert.equal(asset.description, "Recovered");
});
