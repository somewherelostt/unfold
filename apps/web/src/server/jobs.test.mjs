import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JobStore, JobWorker, loadJobConfig } from "@unfold/jobs";
import { compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary } from "@unfold/core";
import { PrivateStorage } from "./private-storage.ts";
import { createJobsApi, jobApiError, jobJson } from "./jobs.ts";
import { createApplicationHandlers, contentFingerprint } from "./job-bindings.ts";
import { prepareExportPlan, ExportRequest } from "./export-plan.ts";
import { fingerprintPlan } from "../../../../packages/video/src/quality.ts";
import { sourceLoader } from "./test-loader.mjs";

const A = { id: "owner-a" }, B = { id: "owner-b" };
const forbidden = (work) => assert.rejects(work, (error) => error.status === 404);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-job-bridge-test-"));
  const storage = new PrivateStorage(path.join(root, "private-v1"));
  const config = loadJobConfig({ UNFOLD_DATA_DIR: root, UNFOLD_JOBS_MIN_FREE_BYTES: "1", UNFOLD_BROWSER_EXECUTABLE: process.execPath });
  const queue = new JobStore(config); const workers = [];
  t.after(async () => { for (const worker of workers) await worker.stop(); queue.close(); await rm(root, { recursive: true, force: true }); });
  const analyses = {};
  for (const [owner, projectId] of [[A, "project-a"], [B, "project-b"]]) {
    await storage.createProject(owner, projectId, "Private project");
    await storage.addAsset(owner, projectId, { assetId: projectId, videoId: projectId, primaryVideoId: projectId, projectId, role: "primary", filename: "clip.mp4", extension: ".mp4", description: "", status: "analyzed", createdAt: 1 });
    const analysis = { ...structuredClone(sampleAnalysis), hasSpeech: false, words: [], videoId: projectId, src: `/media/${projectId}/${projectId}/source.mp4` }; analyses[projectId] = analysis;
    const directory = path.join(storage.projectDir(projectId), "media", projectId); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "source.mp4"), "fixture source bytes; never presented as an actual MP4");
    await writeFile(path.join(directory, "analysis.json"), JSON.stringify(analysis));
    const plan = { ...compileEditPlan(sampleAgentPlans[0], analysis, sampleLibrary, { id: `plan-${projectId}` }), music: null, sfx: [] };
    await storage.putRecord(owner, projectId, "plans", plan.id, { editPlan: plan, agentPlan: sampleAgentPlans[0], videoId: projectId, projectId, revision: 1, createdAt: 1, updatedAt: 1 });
  }
  let preparations = 0;
  const api = createJobsApi({ storage, queue, loadPlan: async (owner, id) => (await storage.getRecord(owner, "plans", id)).value,
    prepareRender: async (_owner, saved, request) => { preparations++; const analysis = analyses[saved.projectId]; return { plan: prepareExportPlan(saved.editPlan, ExportRequest.parse(request), sampleLibrary, { analysis, supporting: [] }), analysis }; } });
  return { root, storage, config, queue, api, analyses, workers, preparations: () => preparations };
}
const renderRequest = (idempotencyKey = "bridge-render-key") => ({ kind: "render", planId: "plan-project-a", resolution: "720p", burnCaptions: true, idempotencyKey });

test("actual job routes authenticate, authorize, deduplicate, reconnect and cancel without executing media", async (t) => {
  const f = await fixture(t); let user = A;
  const load = sourceLoader({ "@/lib/auth/server": { requireUser: async () => user }, "@/server/jobs": { getJobsApi: async () => f.api, jobApiError, jobJson } });
  const post = load("../app/api/jobs/route.ts").POST;
  const get = load("../app/api/jobs/[id]/route.ts").GET;
  const cancel = load("../app/api/jobs/[id]/cancel/route.ts").POST;
  const events = load("../app/api/jobs/[id]/events/route.ts").GET;
  const result = load("../app/api/jobs/[id]/result/route.ts").GET;
  const request = (body) => new Request("http://local/api/jobs", { method: "POST", body: JSON.stringify(body) });
  user = new Response("unauthorized", { status: 401 }); assert.equal((await post(request(renderRequest()))).status, 401); user = A;
  assert.equal((await post(request({ ...renderRequest(), ownerId: B.id }))).status, 400);
  const first = await post(request(renderRequest())); assert.equal(first.status, 202); const queued = await first.json();
  const repeated = await (await post(request(renderRequest()))).json(); assert.equal(repeated.created, false); assert.equal(repeated.job.id, queued.job.id); assert.equal(f.preparations(), 1);
  const context = { params: Promise.resolve({ id: queued.job.id }) };
  user = B; assert.equal((await get(new Request("http://local/"), context)).status, 404); assert.equal((await cancel(new Request("http://local/"), context)).status, 404); assert.equal((await result(new Request("http://local/"), context)).status, 404);
  user = A; assert.equal((await result(new Request("http://local/"), context)).status, 409);
  const viewer = new AbortController(); const response = await events(new Request("http://local/api/jobs/x/events?after=0", { signal: viewer.signal }), context);
  const reader = response.body.getReader(); const firstEvent = new TextDecoder().decode((await reader.read()).value); assert.match(firstEvent, /id: \d+\nevent: job\ndata:/);
  viewer.abort(); await reader.cancel(); assert.equal((await f.api.get(A, queued.job.id)).cancelRequestedAt, null);
  assert.equal((await cancel(new Request("http://local/"), context)).status, 200);
  const reconnect = await events(new Request("http://local/api/jobs/x/events", { headers: { "Last-Event-ID": String(queued.job.revision) } }), context);
  assert.match(await reconnect.text(), /"state":"cancelled"/);
  assert.equal((await f.storage.getProject(A, "project-a")).jobs.length, 0);
  const reopened = new JobStore(f.config); assert.equal(reopened.getForOwner(A.id, queued.job.id).job.state, "cancelled"); reopened.close();
});

test("render enqueue snapshots the clicked canonical edit and preserves it across later saves", async (t) => {
  const f = await fixture(t);
  const saved = (await f.storage.getRecord(A, "plans", "plan-project-a")).value;
  const clicked = { ...saved.editPlan, hookText: "Clicked preview" };
  const request = { ...renderRequest(), editPlan: clicked };
  const queued = await f.api.enqueue(A, request);
  await f.storage.reviseRecord(A, "project-a", saved.editPlan.id, 1, async (value) => ({ ...value, editPlan: { ...value.editPlan, hookText: "New saved edit" } }));
  const snapshot = await f.storage.getJobInput(A, "project-a", queued.job.input.id, queued.job.input.revision);
  assert.equal(snapshot.plan.hookText, "Clicked preview"); assert.equal(snapshot.plan.width, 720); assert.equal(snapshot.planFingerprint, contentFingerprint(snapshot.plan));
  assert.equal(snapshot.submittedInputFingerprint, contentFingerprint(clicked)); assert.equal(snapshot.renderedPlanFingerprint, snapshot.planFingerprint); assert.deepEqual(snapshot.settings, { resolution: "720p", burnCaptions: true });
  assert.equal(snapshot.renderedPlanFingerprint, await fingerprintPlan(snapshot.plan)); assert.equal(snapshot.submittedInputFingerprint, await fingerprintPlan(clicked));
  assert.equal(JSON.stringify(snapshot).includes("render="), false);
  assert.equal((await f.api.enqueue(A, request)).job.id, queued.job.id); assert.equal(f.preparations(), 1);
  await assert.rejects(f.api.enqueue(A, { ...request, burnCaptions: false }), (error) => error.status === 409);
  await forbidden(f.api.enqueue(B, request));
});

test("fixture-only render binding scopes capabilities and publishes MP4/review manifest references", async (t) => {
  const f = await fixture(t); let token; let canonicalFingerprint;
  const handlers = createApplicationHandlers(f.config, { storage: f.storage, origin: "http://trusted.internal", executeChild: async (execution, request) => {
    token = new URL(request.plan.source.src).searchParams.get("render"); assert.ok(token);
    const canonical = request.review.plan; canonicalFingerprint = contentFingerprint(canonical);
    assert.equal(canonical.source.src, "/media/project-a/project-a/source.mp4");
    assert.equal(new URL(request.plan.source.src).origin, "http://trusted.internal");
    assert.ok(await f.storage.renderMediaPath(["project-a", "project-a", "source.mp4"], token));
    await forbidden(f.storage.renderMediaPath(["project-a", "project-a", "analysis.json"], token));
    await forbidden(f.storage.renderMediaPath(["project-b", "project-b", "source.mp4"], token));
    assert.equal(request.options.browserExecutable, process.execPath); assert.equal(request.options.concurrency, 2); assert.equal(request.review.options.maxSeconds, 120);
    await writeFile(request.outputPath, "fixture output bytes; not an end-to-end export");
    const review = { version: 1, planId: canonical.id, planFingerprint: canonicalFingerprint, passed: true, errors: [], warnings: [], checks: [], coverage: { fixture: "No rendered-pixel claim" }, metrics: {}, artifacts: { report: "review.json", contactSheet: "contact-sheet.png", frames: [{ frame: 1, time: 0, label: "Fixture", file: "frames/01.png" }] } };
    const directory = request.review.options.reviewDir; await mkdir(path.join(directory, "frames"), { recursive: true });
    await writeFile(path.join(directory, "review.json"), JSON.stringify(review)); await writeFile(path.join(directory, "contact-sheet.png"), "fixture"); await writeFile(path.join(directory, "frames/01.png"), "fixture");
    return { path: request.outputPath, review };
  } });
  const job = (await f.api.enqueue(A, renderRequest())).job;
  const worker = new JobWorker(f.queue, { handlers }); f.workers.push(worker); worker.tick(); await worker.drain();
  assert.equal((await f.api.get(A, job.id)).state, "succeeded");
  const payload = await f.api.result(A, job.id); assert.equal(payload.review.planFingerprint, canonicalFingerprint); assert.match(payload.url, /^\/media\/project-a\/exports\/job_/); assert.ok(payload.reviewUrl); assert.ok(payload.contactSheetUrl);
  assert.equal(payload.renderedPlanFingerprint, canonicalFingerprint); assert.deepEqual(payload.settings, { resolution: "720p", burnCaptions: true }); assert.match(payload.submittedInputFingerprint, /^[a-f0-9]{64}$/);
  const file = await f.storage.mediaPath(A, payload.url.slice(7).split("/")); assert.match(await readFile(file, "utf8"), /fixture output bytes/);
  await forbidden(f.storage.renderMediaPath(["project-a", "project-a", "source.mp4"], token));
  assert.equal(JSON.stringify(f.queue.events({ ownerId: A.id, projectId: "project-a" }, job.id)).includes(token), false);
  await forbidden(f.api.result(B, job.id));
});

test("fixture-only failed review preserves the published export with an explicit unavailable review", async (t) => {
  const f = await fixture(t);
  const handlers = createApplicationHandlers(f.config, { storage: f.storage, executeChild: async (_ctx, request) => { await writeFile(request.outputPath, "fixture MP4 bytes"); return { path: request.outputPath, reviewError: "internal raw failure should not leak" }; } });
  const job = (await f.api.enqueue(A, renderRequest())).job; const worker = new JobWorker(f.queue, { handlers }); f.workers.push(worker); worker.tick(); await worker.drain();
  const result = await f.api.result(A, job.id); assert.ok(result.url); assert.match(result.reviewError, /automatic review is incomplete/); assert.equal(result.review, undefined); assert.equal(JSON.stringify(result).includes("internal raw"), false);
});

test("fixture-only analysis publishes canonical owned source/metadata before marking the asset analyzed", async (t) => {
  const f = await fixture(t); await f.storage.updateAsset(A, "project-a", "project-a", { status: "uploaded" });
  await rm(path.join(f.storage.projectDir("project-a"), "media/project-a"), { recursive: true });
  const handlers = createApplicationHandlers(f.config, { storage: f.storage, executeChild: async (_ctx, request) => {
    assert.equal(request.options.urlPrefix, "/media/project-a");
    const dir = path.join(request.options.mediaDir, request.options.videoId); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, "source.mp4"), "fixture analyzed proxy"); await writeFile(path.join(dir, "analysis.json"), JSON.stringify(f.analyses["project-a"]));
    return { analysis: f.analyses["project-a"], dir, sourcePath: path.join(dir, "source.mp4"), timings: { total: 1 } };
  } });
  const job = (await f.api.enqueue(A, { kind: "analysis", videoId: "project-a", idempotencyKey: "owned-analysis-key" })).job;
  const worker = new JobWorker(f.queue, { handlers }); f.workers.push(worker); worker.tick(); await worker.drain();
  const result = await f.api.result(A, job.id); assert.equal(result.analysis.src, "/media/project-a/project-a/source.mp4"); assert.equal(result.projectId, "project-a"); assert.equal((await f.storage.getAsset(A, "project-a")).status, "analyzed");
  assert.equal(await readFile(await f.storage.mediaPath(A, ["project-a", "project-a", "source.mp4"]), "utf8"), "fixture analyzed proxy");
});

test("concurrent HTTP intents share one immutable snapshot and queue entry", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.api.enqueue(A, renderRequest()), f.api.enqueue(A, renderRequest())]);
  assert.equal(results[0].job.id, results[1].job.id); assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal((await f.storage.getProject(A, "project-a")).jobs.length, 1);
  assert.equal((await readdir(path.join(f.storage.projectDir("project-a"), "job-inputs"))).filter((file) => file.endsWith(".json")).length, 1);
});

test("snapshot tampering fails before media execution and never becomes a succeeded output", async (t) => {
  const f = await fixture(t); let calls = 0;
  const job = (await f.api.enqueue(A, renderRequest())).job;
  const file = path.join(f.storage.projectDir("project-a"), "job-inputs", `${job.input.id}.json`);
  const data = JSON.parse(await readFile(file, "utf8")); data.value.plan.hookText = "Changed on disk"; await writeFile(file, JSON.stringify(data));
  const handlers = createApplicationHandlers(f.config, { storage: f.storage, executeChild: async () => { calls++; throw new Error("Must not run"); } });
  const worker = new JobWorker(f.queue, { handlers }); f.workers.push(worker); worker.tick(); await worker.drain();
  assert.equal((await f.api.get(A, job.id)).state, "failed"); assert.equal(calls, 0); await assert.rejects(f.api.result(A, job.id), (error) => error.status === 409);
});

test("owner-limit failures release preregistration and project drain reconciles orphan references", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) await f.api.enqueue(A, renderRequest(`owner-limit-${i}`));
  await assert.rejects(f.api.enqueue(A, renderRequest("owner-limit-extra")), (error) => error.status === 429);
  assert.equal((await f.storage.getProject(A, "project-a")).jobs.length, 4);
  await f.storage.registerReference(A, "project-a", "jobs", "orphan-before-sqlite");
  await f.storage.deleteProject(A, "project-a", (ids) => f.api.drainProject(A, "project-a", ids));
  await forbidden(f.storage.getProject(A, "project-a")); assert.equal((await f.storage.getProject(B, "project-b")).ownerId, B.id);
});

test("changed intent after a terminal job does not leave a re-registered project job reference", async (t) => {
  const f = await fixture(t); const job = (await f.api.enqueue(A, renderRequest())).job;
  await f.api.cancel(A, job.id); assert.equal((await f.storage.getProject(A, "project-a")).jobs.length, 0);
  await assert.rejects(f.api.enqueue(A, { ...renderRequest(), burnCaptions: false }), (error) => error.status === 409);
  assert.equal((await f.storage.getProject(A, "project-a")).jobs.length, 0);
});

test("analyzed status stages prior output and still delegates genuine cache validation to the media service", async (t) => {
  const f = await fixture(t); let calls = 0;
  await writeFile(path.join(f.storage.projectDir("project-a"), "media/project-a/analysis.meta.json"), JSON.stringify({ fingerprint: "stale-fixture" }));
  const handlers = createApplicationHandlers(f.config, { storage: f.storage, executeChild: async (_ctx, request) => {
    calls++; assert.equal(request.options.reuseExisting, true); assert.equal(request.options.urlPrefix, "/media/project-a");
    const dir = path.join(request.options.mediaDir, request.options.videoId);
    assert.equal(JSON.parse(await readFile(path.join(dir, "analysis.meta.json"), "utf8")).fingerprint, "stale-fixture");
    // Fixture response deliberately says cache was invalidated; asset status cannot override it.
    await writeFile(path.join(dir, "analysis.json"), JSON.stringify(f.analyses["project-a"]));
    return { analysis: f.analyses["project-a"], timings: { total: 1 }, cached: false };
  } });
  const job = (await f.api.enqueue(A, { kind: "analysis", videoId: "project-a", idempotencyKey: "cache-validation-key" })).job;
  const worker = new JobWorker(f.queue, { handlers }); f.workers.push(worker); worker.tick(); await worker.drain();
  assert.equal(calls, 1); assert.equal((await f.api.result(A, job.id)).cached, false);
});
