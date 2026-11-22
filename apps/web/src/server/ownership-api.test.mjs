import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceLoader } from "./test-loader.mjs";

const A = { id: "owner-a", email: "a@example.invalid" }, B = { id: "owner-b", email: "b@example.invalid" };
async function fixture(t, env = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-api-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let user = A;
  let executions = 0;
  const dependencies = {
    "@/lib/auth/server": { requireUser: async () => user },
    "@/lib/auth/execution": { createExecution: async () => { executions++; throw new Error("Model execution must not be reached by rejected requests"); } },
    "@unfold/agent": {},
  };
  const load = sourceLoader(dependencies, { UNFOLD_DATA_DIR: root, ...env });
  dependencies["@unfold/agent"] = load("../../../../packages/agent/src/client.ts");
  const core = load("../../../../packages/core/src/index.ts");
  dependencies["@unfold/media"] = { loadLibrary: async () => core.sampleLibrary };
  const { storage, store } = load("./store.ts");
  const plans = {};
  const analyses = {};
  for (const [owner, projectId] of [[A, "primary-a"], [B, "primary-b"]]) {
    await storage.createProject(owner, projectId, "Narration");
    await storage.addAsset(owner, projectId, { assetId: projectId, videoId: projectId, projectId, primaryVideoId: projectId, role: "primary", description: "", filename: "narration.mp4", extension: ".mp4", status: "analyzed", createdAt: 1 });
    const analysis = { ...core.sampleAnalysis, videoId: projectId, src: `/media/${projectId}/${projectId}/source.mp4`, frames: [{ t: 0, url: `/media/${projectId}/${projectId}/frames/00.jpg` }] };
    const dir = path.join(storage.projectDir(projectId), "media", projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "analysis.json"), JSON.stringify(analysis));
    await writeFile(path.join(dir, "source.mp4"), "fixture-only-source");
    const agentPlan = { ...core.sampleAgentPlans[0], segments: [{ srcStart: 0, srcEnd: analysis.durationSec, speed: 1 }], music: null, sfx: [], transitions: [], zooms: [], overlays: [] };
    const editPlan = core.compileEditPlan(agentPlan, analysis, core.sampleLibrary, { id: `plan-${projectId}` });
    await store.putPlan(owner, projectId, { editPlan, agentPlan, videoId: projectId, createdAt: 1 });
    plans[projectId] = editPlan;
    analyses[projectId] = analysis;
  }
  return { load, core, storage, store, plans, analyses, dependencies, setUser: (value) => { user = value; }, executionCount: () => executions };
}
const request = (body, method = "POST") => new Request("https://unfold.invalid/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("actual plan, generation, remix, export, analysis and delete handlers reject a foreign project before execution", async (t) => {
  const { load, executionCount } = await fixture(t);
  assert.equal((await load("../app/api/plans/[id]/route.ts").GET(new Request("https://unfold.invalid/api"), { params: Promise.resolve({ id: "plan-primary-b" }) })).status, 404);
  for (const [file, body] of [
    ["variants", { videoId: "primary-b", count: 1 }], ["remix", { planId: "plan-primary-b", message: "Faster cuts" }],
    ["export", { planId: "plan-primary-b" }], ["analyze", { videoId: "primary-b" }],
  ]) assert.equal((await load(`../app/api/${file}/route.ts`).POST(request(body))).status, 404, file);
  const removed = await load("../app/api/projects/[id]/route.ts").DELETE(new Request("https://unfold.invalid/api", { method: "DELETE" }), { params: Promise.resolve({ id: "primary-b" }) });
  assert.equal(removed.status, 404);
  assert.equal(executionCount(), 0);
});

test("revision API persists a manual edit and rejects stale saves with currentRevision", async (t) => {
  const { load, plans } = await fixture(t);
  const route = load("../app/api/plans/[id]/route.ts");
  const ctx = { params: Promise.resolve({ id: "plan-primary-a" }) };
  const editPlan = { ...plans["primary-a"], title: "Saved title" };
  const saved = await route.PATCH(request({ revision: 1, editPlan }, "PATCH"), ctx);
  assert.equal(saved.status, 200);
  const value = await saved.json();
  assert.equal(value.revision, 2);
  assert.equal(value.editPlan.title, "Saved title");
  assert.ok(value.updatedAt > 1);
  const stale = await route.PATCH(request({ revision: 1, editPlan: { ...editPlan, title: "Stale title" } }, "PATCH"), ctx);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).currentRevision, 2);
  const persisted = await (await route.GET(new Request("https://unfold.invalid/api"), ctx)).json();
  assert.equal(persisted.editPlan.title, "Saved title");
});

test("manual save and export reject primary source and foreign supporting substitutions", async (t) => {
  const { load, plans, storage, analyses } = await fixture(t);
  const patch = load("../app/api/plans/[id]/route.ts").PATCH;
  const render = load("../app/api/export/route.ts").POST;
  const ctx = { params: Promise.resolve({ id: "plan-primary-a" }) };
  const sourceSwap = { ...plans["primary-a"], source: plans["primary-b"].source };
  assert.equal((await patch(request({ revision: 1, editPlan: sourceSwap }, "PATCH"), ctx)).status, 400);
  assert.equal((await render(request({ planId: "plan-primary-a", editPlan: sourceSwap }))).status, 400);
  assert.equal((await load("../app/api/remix/route.ts").POST(request({ planId: "plan-primary-a", message: "Keep captions", editPlan: sourceSwap }))).status, 400);
  await storage.addAsset(B, "primary-b", { assetId: "support-b", videoId: "support-b", projectId: "primary-b", primaryVideoId: "primary-b", role: "supporting", description: "", filename: "proof.mp4", extension: ".mp4", status: "analyzed", createdAt: 1 });
  const foreignSupporting = { ...plans["primary-a"], supporting: [{ ...analyses["primary-b"], videoId: "support-b", name: "Proof", description: "" }] };
  assert.equal((await patch(request({ revision: 1, editPlan: foreignSupporting }, "PATCH"), ctx)).status, 404);
  assert.equal((await render(request({ planId: "plan-primary-a", editPlan: foreignSupporting }))).status, 404);
  assert.equal((await load("../app/api/remix/route.ts").POST(request({ planId: "plan-primary-a", message: "Keep captions", editPlan: foreignSupporting }))).status, 404);
  assert.equal((await load("../app/api/variants/route.ts").POST(request({ videoId: "primary-a", supportingAssetIds: ["support-b"] }))).status, 404);
});

test("supporting media metadata is canonicalized and URL substitutions are rejected", async (t) => {
  const { load, plans, storage, analyses } = await fixture(t);
  await storage.addAsset(A, "primary-a", { assetId: "support-a", videoId: "support-a", projectId: "primary-a", primaryVideoId: "primary-a", role: "supporting", description: "Trusted description", filename: "detail.mp4", extension: ".mp4", status: "analyzed", createdAt: 1 });
  const analysis = { ...analyses["primary-a"], videoId: "support-a", src: "/media/primary-a/support-a/source.mp4", frames: [] };
  const dir = path.join(storage.projectDir("primary-a"), "media", "support-a");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "analysis.json"), JSON.stringify(analysis));
  const patch = load("../app/api/plans/[id]/route.ts").PATCH;
  const ctx = { params: Promise.resolve({ id: "plan-primary-a" }) };
  const supporting = [{ videoId: "support-a", src: analysis.src, name: "Caller name", description: "Caller description", width: 999, height: 999, durationSec: 999, frames: [] }];
  const swapped = { ...plans["primary-a"], supporting: [{ ...supporting[0], src: "https://elsewhere.invalid/video" }] };
  assert.equal((await patch(request({ revision: 1, editPlan: swapped }, "PATCH"), ctx)).status, 400);
  const saved = await patch(request({ revision: 1, editPlan: { ...plans["primary-a"], supporting } }, "PATCH"), ctx);
  assert.equal(saved.status, 200);
  const value = await saved.json();
  assert.equal(value.editPlan.supporting[0].name, "detail.mp4");
  assert.equal(value.editPlan.supporting[0].description, "Trusted description");
  assert.equal(value.editPlan.supporting[0].width, analysis.width);
});

test("SSE export contract binds submitted and canonical plans and preserves MP4 readiness when fixture review fails", async (t) => {
  const { load, plans, dependencies } = await fixture(t);
  const { fingerprintPlan } = load("../../../../packages/video/src/quality.ts");
  dependencies["node:fs/promises"] = { ...await import("node:fs/promises"), statfs: async () => ({ bavail: 10_000_000, bsize: 4096 }) };
  let reviewFails = false;
  dependencies["@unfold/video/render"] = { renderPlan: async (plan, outputPath, options) => {
    assert.match(plan.source.src, /\?render=/);
    await writeFile(outputPath, "fixture-only-mp4");
    options.onProgress(1);
  } };
  dependencies["@unfold/video/review"] = { fingerprintPlan, reviewRenderedPlan: async (plan, options) => {
    assert.equal(plan.source.src.includes("render="), false);
    if (reviewFails) throw new Error("Fixture review failure");
    const report = { planFingerprint: await fingerprintPlan(plan), artifacts: { report: "review.json", contactSheet: "", frames: [] } };
    await mkdir(options.reviewDir, { recursive: true });
    await writeFile(path.join(options.reviewDir, "review.json"), JSON.stringify(report));
    return report;
  } };
  const route = load("../app/api/export/route.ts");
  for (const includePreview of [true, false]) {
    reviewFails = !includePreview;
    const submitted = { ...plans["primary-a"], title: "Submitted preview" };
    delete submitted.stats;
    const response = await route.POST(request({ planId: "plan-primary-a", ...(includePreview ? { editPlan: submitted, resolution: "720p", burnCaptions: false } : {}) }));
    assert.equal(response.status, 200);
    const text = await response.text();
    const event = text.split("\n\n").find((part) => part.startsWith("event: ready\n"));
    assert.ok(event, text);
    const ready = JSON.parse(event.slice(event.indexOf("data: ") + 6));
    assert.equal(ready.submittedInputFingerprint, await fingerprintPlan(includePreview ? submitted : plans["primary-a"]));
    assert.equal(ready.renderedPlanFingerprint.length, 64);
    assert.deepEqual(ready.settings, includePreview ? { resolution: "720p", burnCaptions: false } : { resolution: "1080p", burnCaptions: true });
    assert.equal(JSON.stringify(ready).includes("render="), false);
    assert.match(ready.url, /^\/media\/primary-a\/exports\//);
    if (includePreview) assert.equal(ready.review.planFingerprint, ready.renderedPlanFingerprint);
    else { assert.equal(ready.review, undefined); assert.match(ready.reviewError, /review is incomplete/); }
  }
});

test("mocked remix boundary receives the canonical current preview without export scaling", async (t) => {
  const { load, plans, dependencies } = await fixture(t);
  const captured = [];
  dependencies["@/lib/auth/execution"] = { createExecution: async () => ({ config: {}, dispose: async () => {} }) };
  dependencies["@unfold/agent"] = { ...dependencies["@unfold/agent"], remixPlan: async (_context, _historical, _message, options) => {
    captured.push(options.currentEdit);
    throw new Error("Fixture stops after request-context inspection");
  } };
  const route = load("../app/api/remix/route.ts");
  const preview = { ...plans["primary-a"], width: 720, height: 1280, captions: { ...plans["primary-a"].captions, enabled: false }, broll: [] };
  const response = await route.POST(request({ planId: "plan-primary-a", message: "Keep these captions off", editPlan: preview }));
  await response.text();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].captions.enabled, false);
  assert.equal(captured[0].width, 720);
  assert.equal(captured[0].height, 1280);
  assert.equal(captured[0].broll.length, 0);
  const legacy = await route.POST(request({ planId: "plan-primary-a", message: "Keep the current edit" }));
  await legacy.text();
  assert.equal(captured.length, 2);
  assert.equal(captured[1].source.src, plans["primary-a"].source.src);
});

test("local fixture import is unavailable outside explicit unconfigured demo mode", async (t) => {
  const { load } = await fixture(t);
  const { importLocalFixture } = load("./local-fixture.ts");
  await assert.rejects(importLocalFixture({ projectId: "primary-a", editPlan: {}, agentPlan: {} }), (error) => error.status === 403);
});

test("local fixture import verifies the fixed demo owner, labels technical output and refuses overwrite", async (t) => {
  const { load, storage, core, analyses } = await fixture(t, { UNFOLD_DEV_NO_AUTH: "1" });
  const owner = load("../lib/auth/env.ts").DEV_USER;
  const projectId = "fresh-demo-primary";
  await storage.createProject(owner, projectId, "Fresh narration");
  await storage.addAsset(owner, projectId, { assetId: projectId, videoId: projectId, projectId, primaryVideoId: projectId, role: "primary", description: "", filename: "speech.mp4", extension: ".mp4", status: "analyzed", createdAt: 1 });
  const analysis = { ...analyses["primary-a"], videoId: projectId, src: `/media/${projectId}/${projectId}/source.mp4` };
  const dir = path.join(storage.projectDir(projectId), "media", projectId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "analysis.json"), JSON.stringify(analysis));
  const agentPlan = { ...core.sampleAgentPlans[0], segments: [{ srcStart: 0, srcEnd: analysis.durationSec, speed: 1 }], music: null, sfx: [], transitions: [], zooms: [], overlays: [] };
  const editPlan = core.compileEditPlan(agentPlan, analysis, core.sampleLibrary, { id: "local-speech-fixture" });
  const { importLocalFixture } = load("./local-fixture.ts");
  const saved = await importLocalFixture({ projectId, agentPlan, editPlan });
  assert.equal(saved.projectId, projectId);
  assert.match(saved.editPlan.title, /^Local technical fixture/);
  assert.equal(saved.editPlan.stats, null);
  assert.equal(saved.editPlan.source.src, analysis.src);
  await assert.rejects(importLocalFixture({ projectId, agentPlan, editPlan }), (error) => error.status === 409);
  await assert.rejects(importLocalFixture({ projectId: "primary-a", agentPlan, editPlan }), (error) => error.status === 404);
});

test("fixture-backed generation persists exact received briefs and server provenance through owned SSE and GET", async (t) => {
  const { load, core, store, storage, plans, analyses, dependencies, setUser } = await fixture(t);
  await storage.addAsset(A, "primary-a", { assetId: "support-requested", videoId: "support-requested", projectId: "primary-a", primaryVideoId: "primary-a", role: "supporting", description: "Fixture detail", filename: "detail.mp4", extension: ".mp4", status: "analyzed", createdAt: 1 });
  const supportDir = path.join(storage.projectDir("primary-a"), "media", "support-requested");
  await mkdir(supportDir, { recursive: true });
  await writeFile(path.join(supportDir, "analysis.json"), JSON.stringify({ ...analyses["primary-a"], videoId: "support-requested", src: "/media/primary-a/support-requested/source.mp4" }));
  const profile = core.StyleProfile.parse({ summary: "Fixture style", cutsPerMinute: 30, avgShotSec: 2, captions: core.sampleAgentPlans[0].captions, transitions: [], zoomIntensity: 0, sfxDensityPerMin: 0, musicEnergy: 0, musicMoods: [] });
  await store.putStyle(A, "primary-a", "requested-style", { profile, sourceUrl: null });
  const modelRequests = [];
  dependencies["@/lib/auth/execution"] = { createExecution: async () => ({ mode: "user-key", config: {}, dispose: async () => {} }) };
  dependencies["@unfold/agent"] = { ...dependencies["@unfold/agent"], generateVariants: async function* (_context, brief, options) {
    const index = modelRequests.length;
    modelRequests.push({ brief, options });
    yield { index: 0, direction: `Fixture direction ${index}`, result: { editPlan: { ...plans["primary-a"], id: `provenance-fixture-${index}` }, agentPlan: core.sampleAgentPlans[0], stats: { outputTokens: 1, tps: 1 } } };
  } };
  const generate = load("../app/api/variants/route.ts").POST;
  const get = load("../app/api/plans/[id]/route.ts").GET;
  const presetBrief = "Highlight the product details.\nKeep the original speech.  ";
  const cases = [
    { body: {}, receivedBrief: "" },
    { body: { prompt: "" }, receivedBrief: "" },
    { body: { prompt: " \n " }, receivedBrief: " \n " },
    { body: { prompt: presetBrief, aspect: "16:9", supportingAssetIds: ["support-requested"], styleId: "requested-style" }, receivedBrief: presetBrief },
  ];
  for (const [index, example] of cases.entries()) {
    const response = await generate(request({ videoId: "primary-a", count: 1, ...example.body, origin: "caller-claimed-preset", sourceHash: "caller-claimed-hash", generationRequest: { receivedBrief: "forged brief" } }));
    assert.equal(response.status, 200);
    const events = (await response.text()).split("\n\n").filter(Boolean).map((event) => ({ type: event.split("\n")[0].slice(7), data: JSON.parse(event.split("\ndata: ")[1]) }));
    const start = events.find((event) => event.type === "start").data;
    const variant = events.find((event) => event.type === "variant").data;
    const provenance = variant.generationRequest;
    assert.equal(provenance.version, 1);
    assert.equal(provenance.receivedBrief, example.receivedBrief);
    assert.equal(modelRequests[index].brief, example.receivedBrief);
    assert.equal(provenance.direction, variant.direction);
    assert.equal(provenance.createdAt, start.startedAt);
    assert.deepEqual(provenance.supportingAssetIds, example.body.supportingAssetIds ?? []);
    assert.equal(provenance.requestedAspect, example.body.aspect);
    assert.equal(provenance.styleId, example.body.styleId);
    assert.equal(provenance.origin, undefined);
    assert.equal(provenance.sourceHash, undefined);
    const ctx = { params: Promise.resolve({ id: variant.editPlan.id }) };
    const owned = await get(new Request("https://unfold.invalid/api"), ctx);
    assert.equal(owned.status, 200);
    assert.deepEqual((await owned.json()).generationRequest, provenance);
    setUser(B);
    assert.equal((await get(new Request("https://unfold.invalid/api"), ctx)).status, 404);
    setUser(A);
  }
  assert.equal((await store.getPlan(A, "plan-primary-a")).generationRequest, undefined);
});

test("fixture-backed variant failures expose safe known codes and never create a completed plan", async (t) => {
  const { load, storage, dependencies } = await fixture(t);
  const { AgentServiceError } = dependencies["@unfold/agent"];
  let failureCode;
  let attempts = 0, releases = 0;
  dependencies["@/lib/auth/execution"] = { createExecution: async () => { attempts++; return { mode: "user-key", config: {}, dispose: async () => { releases++; } }; } };
  dependencies["@unfold/agent"] = { ...dependencies["@unfold/agent"], generateVariants: async function* () {
    yield { index: 0, direction: "Fixture failure", errorCode: failureCode, error: "fixture raw provider secret", retryable: true };
  } };
  const generate = load("../app/api/variants/route.ts").POST;
  const codes = ["RATE_LIMITED", "UNAVAILABLE", "AUTH_REJECTED", "CANCELLED", "CONNECTION", "INVALID_RESPONSE", undefined, "FUTURE_UNKNOWN"];
  for (const code of codes) {
    failureCode = code;
    const response = await generate(request({ videoId: "primary-a", prompt: "Preserve this brief", count: 1 }));
    assert.equal(response.status, 200);
    const text = await response.text();
    const events = text.split("\n\n").filter(Boolean).map((event) => ({ type: event.split("\n")[0].slice(7), data: JSON.parse(event.split("\ndata: ")[1]) }));
    const failure = events.find((event) => event.type === "variant-error").data;
    if (code && code !== "FUTURE_UNKNOWN") {
      const expected = new AgentServiceError(code);
      assert.equal(failure.errorCode, code);
      assert.equal(failure.message, expected.message);
      assert.equal(failure.retryable, expected.retryable);
    } else {
      assert.equal(failure.errorCode, undefined);
      assert.doesNotMatch(failure.message, /busy|rate.limit|key|credential/i);
    }
    assert.equal(text.includes("raw provider secret"), false);
    assert.equal(events.some((event) => event.type === "variant"), false);
    assert.equal(events.find((event) => event.type === "summary").data.ok, 0);
    assert.equal((await storage.getProject(A, "primary-a")).plans.length, 1);
    assert.equal(Object.keys((await storage.getProject(A, "primary-a")).leases).length, 0);
  }
  assert.equal(attempts, codes.length);
  assert.equal(releases, codes.length);
});

test("mocked remix errors preserve safe service codes, discard raw failures and keep the saved edit", async (t) => {
  const { load, store, storage, dependencies } = await fixture(t);
  const { AgentServiceError } = dependencies["@unfold/agent"];
  let failure;
  let attempts = 0;
  dependencies["@/lib/auth/execution"] = { createExecution: async () => ({ config: {}, dispose: async () => {} }) };
  dependencies["@unfold/agent"] = { ...dependencies["@unfold/agent"], remixPlan: async () => { attempts++; throw failure; } };
  const remix = load("../app/api/remix/route.ts").POST;
  const original = await store.getPlan(A, "plan-primary-a");
  const codes = ["RATE_LIMITED", "UNAVAILABLE", "AUTH_REJECTED", "CANCELLED", "CONNECTION", "INVALID_RESPONSE", undefined];
  for (const code of codes) {
    failure = code ? new AgentServiceError(code) : new Error("fixture untyped private detail");
    const response = await remix(request({ planId: "plan-primary-a", message: "Keep my current edit" }));
    const text = await response.text();
    const event = text.split("\n\n").find((part) => part.startsWith("event: error\n"));
    assert.ok(event, text);
    const safe = JSON.parse(event.slice(event.indexOf("data: ") + 6));
    assert.equal(safe.errorCode, code);
    if (code) assert.equal(safe.message, new AgentServiceError(code).message);
    else assert.doesNotMatch(safe.message, /busy|rate.limit|key|credential/i);
    assert.equal(text.includes("private"), false);
    assert.equal(text.includes("event: plan\n"), false);
    assert.equal((await store.getPlan(A, "plan-primary-a")).revision, original.revision);
    assert.equal((await storage.getProject(A, "primary-a")).plans.length, 1);
  }
  assert.equal(attempts, codes.length);
});

test("actual abort during execution startup returns cancellation and releases the project lease", async (t) => {
  const { load, storage, dependencies } = await fixture(t);
  const controller = new AbortController();
  dependencies["@/lib/auth/execution"] = { createExecution: async () => { controller.abort("fixture private abort detail"); throw new Error("fixture private connection detail"); } };
  const generate = load("../app/api/variants/route.ts").POST;
  const response = await generate(new Request(request({ videoId: "primary-a", count: 1 }), { signal: controller.signal }));
  assert.equal(response.status, 499);
  const failure = await response.json();
  assert.equal(failure.errorCode, "CANCELLED");
  assert.equal(failure.retryable, false);
  assert.equal(JSON.stringify(failure).includes("private"), false);
  assert.equal(Object.keys((await storage.getProject(A, "primary-a")).leases).length, 0);
});
