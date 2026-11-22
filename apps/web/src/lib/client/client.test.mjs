import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const here = dirname(fileURLToPath(import.meta.url));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const stats = { genMs: 600, tps: 1000, outputTokens: 600, model: "kimi-k3.1-pro" };
const track = { id: "music", title: "Drift", url: "/assets/music/drift.mp3", bpm: 120, beats: [0, 0.5, 1], downbeats: [0], moods: ["hype"], energy: 0.8 };
const library = { music: [track], sfx: [] };
const analysis = (videoId = "sample") => ({ videoId, src: "/sample.mp4", durationSec: 10, width: 1080, height: 1920, words: [], scenes: [], frames: [] });
function plan(id) {
  return {
    version: 1, id, title: "My edit", rationale: "Open on the hook", style: "custom", aspect: "9:16", fps: 30, width: 1080, height: 1920, durationSec: 10,
    source: { videoId: "sample", src: "/sample.mp4", width: 1080, height: 1920 }, hookText: null,
    clips: [{ id: "a", start: 0, end: 5, srcStart: 0, srcEnd: 5, speed: 1 }, { id: "b", start: 5, end: 10, srcStart: 5, srcEnd: 10, speed: 1 }],
    captions: { enabled: true, preset: "clean-pop", position: "lower", uppercase: false, highlightColor: "#FFE14D", chunks: [] },
    music: null, transitions: [], zooms: [], sfx: [], overlays: [], stats: null,
  };
}

/** Load isolated client modules with controllable network calls and a fresh tab's storage. */
function harness(apiOverrides = {}, storage = new Map(), extra = {}) {
  const timers = new Map();
  let timerId = 0;
  let call = 0;
  const api = {
    analyze: async (id) => analysis(id), uploadVideo: async () => ({ videoId: "upload" }), reference: async () => ({ styleId: "copied", title: "Inspiration" }),
    getLibrary: async () => library,
    async *generateVariants(req) {
      const run = ++call;
      yield { type: "start" };
      for (let i = 0; i < req.count; i++) yield { type: "variant", index: i, editPlan: plan(`${run}-${i}`), stats };
    },
    ...apiOverrides,
  };
  const imports = {
    "react": { useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    "@unfold/core": { sampleLibrary: library, ASPECT_SIZE: { "9:16": { width: 1080, height: 1920 }, "1:1": { width: 1080, height: 1080 }, "16:9": { width: 1920, height: 1080 } } },
    "./api": api,
    "@/components/ui/prompt-draft": { readPromptDraft: async () => null, removePromptDraft: async () => {} },
    ...extra,
  };
  const context = vm.createContext({
    AbortController, DOMException, TextDecoderStream, Response, console,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id),
    process: { env: {} },
    window: { sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
  });
  const cache = new Map();
  function load(file) {
    const path = resolve(here, file);
    if (cache.has(path)) return cache.get(path).exports;
    const loadedModule = { exports: {} };
    cache.set(path, loadedModule);
    const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = (name) => {
      if (name in imports) return imports[name];
      if (name.startsWith(".")) return load(resolve(dirname(path), `${name}.ts`));
      throw new Error(`Unexpected import: ${name}`);
    };
    vm.runInContext(`(function(require,module,exports){${output}\n})`, context, { filename: path })(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  const store = load("store.ts");
  imports["./store"] = store;
  store.getState();
  return { ...store, api, storage, load, imports, context, flush: () => { for (const fn of timers.values()) fn(); timers.clear(); } };
}

test("manual controls add missing music, transitions and zooms, and remove an agent sound", () => {
  const h = harness();
  const base = plan("one");
  base.sfx = [{ at: 1, sfxId: "boom", url: "/boom.wav", name: "Boom", volume: 0.8 }];
  const edited = h.applyOverrides(base, { music: true, trackId: "music", transitions: true, transitionTypes: { 0: "flash" }, zooms: true, sfxRemoved: [0], aspect: "1:1" }, library);
  assert.equal(edited.music.trackId, "music");
  assert.equal(edited.transitions[0].at, 5);
  assert.equal(edited.transitions[0].type, "flash");
  assert.equal(edited.transitions[0].durationSec, 0.12);
  assert.equal(edited.zooms.length, 2);
  assert.equal(edited.sfx.length, 0);
  assert.equal(edited.width, edited.height);
  assert.equal(base.music, null);
  assert.equal(base.sfx.length, 1);
});

test("edit summaries distinguish continuous clips from cuts and do not infer beat syncing from music", () => {
  const h = harness();
  const { planSummary, planSteps } = h.load("narrate.ts");
  const continuous = plan("continuous");
  continuous.clips = [continuous.clips[0]];
  continuous.durationSec = 5;
  assert.match(planSummary(continuous), /5\.0s edit, 1 clip, 0 sound effects/);
  assert.doesNotMatch(planSummary(continuous), /cut/);
  assert.match(planSteps(continuous).at(-1), /continuous shot/);
  const sequence = plan("sequence");
  sequence.music = track;
  sequence.sfx = [{ at: 1, sfxId: "hit", url: "/hit.mp3", name: "Hit", volume: 0.5 }];
  assert.match(planSummary(sequence), /2 clips with 120 BPM music, 1 sound effect\./);
  assert.doesNotMatch(planSteps(sequence)[2], /cuts|beat/);
});

test("replacing or clearing a clip discards delayed upload and analysis results", async () => {
  const old = deferred();
  const h = harness({ uploadVideo: (file) => file.name === "old.mp4" ? old.promise : Promise.resolve({ videoId: "new" }) });
  const first = h.actions.upload({ name: "old.mp4", type: "video/mp4" });
  assert.equal(await h.actions.upload({ name: "new.mp4", type: "video/mp4" }), true);
  old.resolve({ videoId: "old" });
  assert.equal(await first, false);
  assert.equal(h.getState().project.analysis.videoId, "new");

  const late = deferred();
  h.api.analyze = () => late.promise;
  const pending = h.actions.upload({ name: "cleared.mp4", type: "video/mp4" });
  await tick();
  h.actions.clearUpload();
  late.resolve(analysis("cleared"));
  await pending;
  assert.equal(h.getState().project.videoId, null);
  assert.equal(h.getState().project.analysis, null);
});

test("a cancelled preparation cannot remove the retry's cancellation controller", async () => {
  const old = deferred(), next = deferred();
  let calls = 0, secondSignal;
  const h = harness({ analyze: (_id, signal) => { if (++calls === 1) return old.promise; secondSignal = signal; return next.promise; } });
  const first = h.actions.generate();
  h.actions.cancel("main");
  const retry = h.actions.generate();
  old.resolve(analysis());
  await first;
  h.actions.cancel("main");
  assert.equal(secondSignal.aborted, true);
  next.resolve(analysis());
  await retry;
  assert.equal(h.getState().run.status, "cancelled");
});

test("alternate groups exist while streaming, keep earlier takes, and retain inspiration after reload", async () => {
  const gate = deferred();
  let call = 0;
  const h = harness({ async *generateVariants(req) {
    const run = ++call;
    yield { type: "start" };
    for (let i = 0; i < req.count; i++) {
      yield { type: "variant", index: i, editPlan: plan(`${run}-${i}`), stats };
      if (run === 2 && i === 0) await gate.promise;
    }
  } });
  h.actions.setPrompt("Original request");
  h.actions.setReferenceUrl("https://example.test/clip");
  const root = await h.actions.generate();
  const running = h.actions.generateAlternates(root);
  await tick();
  assert.equal(h.getState().altRoot["2-0"], root);
  gate.resolve();
  await running;
  await h.actions.generateAlternates(root);
  assert.equal(h.getState().alts[root].slots.length, 6);
  assert.equal(h.getState().alts[root].slots[0], "2-0");
  h.flush();
  let request;
  const fresh = harness({ async *generateVariants(req) { request = req; yield { type: "start" }; yield { type: "variant", index: 0, editPlan: plan("fresh"), stats }; } }, h.storage);
  fresh.actions.setPrompt("Unrelated new project");
  await fresh.actions.generateAlternates(root);
  assert.equal(request.styleId, "copied");
  assert.match(request.prompt, /Original request/);
  assert.doesNotMatch(request.prompt, /Unrelated/);
});

test("reload settles pending work and retains undoable manual edits", async () => {
  const h = harness();
  const id = await h.actions.generate();
  h.actions.override(id, { hookText: "Keep this hook" });
  const upload = deferred();
  h.api.uploadVideo = () => upload.promise;
  const pending = h.actions.upload({ name: "pending.mp4", type: "video/mp4" });
  const generation = h.actions.generate();
  h.flush();
  const fresh = harness({}, h.storage);
  assert.equal(fresh.getState().run.status, "error");
  assert.equal(fresh.getState().run.interrupted, true);
  assert.equal(fresh.getState().project.analyzing, false);
  assert.equal(fresh.getState().plans[id].overrides.hookText, "Keep this hook");
  fresh.actions.undo(id);
  assert.equal(fresh.getState().plans[id].overrides.hookText, undefined);
  h.actions.cancel("main");
  h.actions.clearUpload();
  upload.resolve({ videoId: "old" });
  await Promise.all([pending, generation]);
});

test("draft recovery deduplicates uploads and keeps failed drafts available for retry", async () => {
  const read = deferred();
  let uploads = 0, removed = 0;
  const h = harness({ uploadVideo: async () => { uploads++; return { videoId: "clip" }; } }, new Map(), {
    "@/components/ui/prompt-draft": { readPromptDraft: () => read.promise, removePromptDraft: async () => { removed++; } },
  });
  const { recoverPromptDraft } = h.load("draft.ts");
  const first = recoverPromptDraft("draft");
  assert.equal(recoverPromptDraft("draft"), first);
  read.resolve({ prompt: "Edit my clip", style: "Clean", aspect: "1:1", file: { name: "clip.mp4", type: "video/mp4" } });
  await first;
  assert.equal(uploads, 1);
  assert.equal(removed, 1);
  assert.equal(h.getState().project.aspect, "1:1");
  h.api.uploadVideo = async () => { throw new Error("Upload unavailable"); };
  await assert.rejects(recoverPromptDraft("retry"), /Upload unavailable/);
  assert.equal(removed, 1);
  h.api.uploadVideo = async () => ({ videoId: "retry" });
  await recoverPromptDraft("retry");
  assert.equal(removed, 2);
});

test("landing prompt parameters persist before the app URL is consumed", () => {
  const storage = new Map();
  const h = harness({}, storage, { "@/components/ui/prompt-draft": {} });
  const { adoptPromptSearch } = h.load("draft.ts");
  assert.equal(adoptPromptSearch(new URLSearchParams({ prompt: "Keep my own words", style: "Clean", aspect: "1:1" })), true);
  const restored = harness({}, storage);
  assert.equal(restored.getState().project.prompt, "Keep my own words");
  assert.equal(restored.getState().project.promptStyle, "Clean");
  assert.equal(restored.getState().project.aspect, "1:1");
  restored.actions.setPrompt("My revised direction");
  restored.flush();
  assert.equal(harness({}, storage).getState().project.prompt, "My revised direction");
  assert.equal(adoptPromptSearch(new URLSearchParams()), false);
  assert.equal(h.getState().project.prompt, "Keep my own words");
  assert.equal(adoptPromptSearch(new URLSearchParams({ draft: "attached", prompt: "Wait for the attached draft" })), false);
});

test("a delayed attachment recovery preserves changes typed while it is loading", async () => {
  const read = deferred();
  const h = harness({}, new Map(), {
    "@/components/ui/prompt-draft": { readPromptDraft: () => read.promise, removePromptDraft: async () => {} },
  });
  const recovery = h.load("draft.ts").recoverPromptDraft("slow");
  h.actions.setPrompt("The newer text wins");
  h.actions.setPromptStyle("Chaos");
  h.actions.setAspect("16:9");
  read.resolve({ prompt: "Old landing text", style: "Clean", aspect: "1:1", file: { name: "clip.mp4", type: "video/mp4" } });
  await recovery;
  assert.equal(h.getState().project.prompt, "The newer text wins");
  assert.equal(h.getState().project.promptStyle, "Chaos");
  assert.equal(h.getState().project.aspect, "16:9");
  assert.equal(h.getState().project.fileName, "clip.mp4");
});

test("failed local persistence keeps the original attachment available for recovery", async () => {
  let removed = 0;
  const h = harness({}, new Map(), {
    "@/components/ui/prompt-draft": {
      readPromptDraft: async () => ({ prompt: "Keep this", style: "Clean", aspect: "9:16", file: { name: "clip.mp4", type: "video/mp4" } }),
      removePromptDraft: async () => { removed++; },
    },
  });
  h.context.window.sessionStorage.setItem = () => { throw new Error("Storage is full"); };
  await assert.rejects(h.load("draft.ts").recoverPromptDraft("retained"), /couldn't save this draft/);
  assert.equal(removed, 0);
  assert.equal(h.getState().project.prompt, "Keep this");
  assert.equal(h.getState().project.fileName, "clip.mp4");
});

test("export sends the preview plan and options, and reports an interrupted stream", async () => {
  const h = harness({}, new Map(), { "./mock": {} });
  let request;
  h.context.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response('event: progress\ndata: {"progress":0.5}\n\nevent: ready\ndata: {"url":"/export.mp4"}\n\nevent: done\ndata: {}\n\n');
  };
  const api = h.load("api.ts");
  const edited = plan("stored");
  edited.hookText = "Manual hook";
  const events = [];
  for await (const event of api.exportVideo("stored", { editPlan: edited, resolution: "720p", burnCaptions: false })) events.push(event);
  assert.equal(request.editPlan.hookText, "Manual hook");
  assert.equal(request.planId, "stored");
  assert.equal(request.resolution, "720p");
  assert.equal(request.burnCaptions, false);
  assert.equal(events.at(-1).url, "/export.mp4");
  h.context.fetch = async () => new Response('event: progress\ndata: {"progress":0.2}\n\n');
  await assert.rejects(async () => { for await (const event of api.exportVideo("stored")) void event; }, /connection closed/);
});

test("caption design controls persist, undo, and replace a previous design when choosing a preset", async () => {
  const h = harness();
  const id = await h.actions.generate();
  const design = { typeface: "serif", fontScale: 0.8, weight: "regular", textColor: "#ECE8DF", highlightMode: "none", animation: "none", outline: false };
  h.actions.override(id, { captionDesign: design });
  assert.equal(h.usePlan(id).plan.captions.design.typeface, "serif");
  h.actions.undo(id);
  assert.equal(h.usePlan(id).plan.captions.design, undefined);
  h.actions.redo(id);
  assert.equal(h.usePlan(id).plan.captions.design.fontScale, 0.8);
  h.flush();
  const fresh = harness({}, h.storage);
  assert.equal(fresh.usePlan(id).plan.captions.design.textColor, "#ECE8DF");
  const base = { ...plan("saved"), captions: { ...plan("saved").captions, design } };
  assert.equal(h.applyOverrides(base, { captionPreset: "bold-pop" }, library).captions.design, undefined);
});

test("supporting uploads are source-scoped and a replaced primary cannot receive late assets", async () => {
  const late = deferred();
  const h = harness({ uploadSupporting: () => late.promise });
  await h.actions.upload({ name: "primary.mp4", type: "video/mp4" });
  const original = h.getState().project.videoId;
  const pending = h.actions.uploadSupporting(original, { name: "detail.mp4", type: "video/mp4" });
  h.api.uploadVideo = async () => ({ videoId: "other-project" });
  await h.actions.upload({ name: "different.mp4", type: "video/mp4" });
  late.resolve({ videoId: "late-detail" });
  assert.equal(await pending, false);
  assert.equal(h.getState().project.videoId, "other-project");
  assert.equal(h.getState().supporting[original][0].status, "cancelled");
  assert.equal(h.getState().supporting["other-project"], undefined);
});

test("generation uses only selected ready supporting asset IDs from its own primary", async () => {
  let request, serial = 0;
  const h = harness({ uploadSupporting: async () => ({ videoId: `support-${++serial}` }), async *generateVariants(req) { request = req; yield { type: "variant", index: 0, editPlan: plan("with-assets"), stats }; } });
  await h.actions.upload({ name: "primary.mp4", type: "video/mp4" });
  await h.actions.uploadSupporting("upload", { name: "proof.mp4", type: "video/mp4" });
  await h.actions.uploadSupporting("upload", { name: "context.mp4", type: "video/mp4" });
  const second = h.getState().supporting.upload[1];
  h.actions.selectSupporting("upload", second.id, false);
  await h.actions.generate();
  assert.deepEqual(Array.from(request.supportingAssetIds), ["support-1"]);
  assert.equal(request.supporting, undefined);
  assert.equal(h.getState().plans["with-assets"].request.supportingAssetIds[0], "support-1");
});

function supportingFixture() {
  return { videoId: "detail", name: "Hands demonstrating the product", description: "A real close-up", src: "/detail.mp4", width: 1920, height: 1080, durationSec: 6, frames: [{ t: 0, url: "/detail0.jpg" }, { t: 1, url: "/detail1.jpg" }, { t: 2, url: "/detail2.jpg" }] };
}

test("manual cutaways survive reload, disable, undo and redo with exact preview/export parity", async () => {
  const h = harness({}, new Map(), { "./mock": {} });
  const id = await h.actions.generate();
  const asset = supportingFixture();
  const { newBroll } = h.load("broll.ts");
  const shot = newBroll({ ...h.usePlan(id).plan, supporting: [asset] }, asset, 1);
  h.actions.override(id, { supporting: [asset], broll: [shot] });
  h.actions.override(id, { brollDisabled: [shot.id] });
  assert.equal(h.usePlan(id).plan.broll.length, 0);
  h.actions.undo(id);
  assert.equal(h.usePlan(id).plan.broll[0].assetId, "detail");
  h.actions.redo(id);
  h.actions.undo(id);
  h.flush();
  const restored = harness({}, h.storage, { "./mock": {} });
  const preview = restored.usePlan(id).plan;
  assert.equal(preview.broll[0].start, 1);
  assert.equal(preview.broll[0].clipId, "a");
  let body;
  restored.context.fetch = async (_url, options) => { body = JSON.parse(options.body); return new Response('event: ready\ndata: {"url":"/real-export.mp4"}\n\n'); };
  for await (const event of restored.load("api.ts").exportVideo(id, { editPlan: preview })) void event;
  assert.deepEqual(body.editPlan.broll, JSON.parse(JSON.stringify(preview.broll)));
  assert.deepEqual(body.editPlan.supporting, JSON.parse(JSON.stringify(preview.supporting)));
});

test("manual placement recomputes narration anchors and rejects unsupported ranges and asset IDs", () => {
  const h = harness();
  const { newBroll, reviseBroll } = h.load("broll.ts");
  const p = { ...plan("anchored"), supporting: [supportingFixture()] };
  const shot = newBroll(p, p.supporting[0], 1);
  const moved = reviseBroll(p, shot, { start: 6, end: 8 });
  assert.equal(moved.clipId, "b");
  assert.equal(moved.segmentIndex, 1);
  assert.equal(moved.atSrcTime, 6);
  assert.throws(() => reviseBroll(p, shot, { assetId: "not-attached" }), /attached/);
  assert.throws(() => reviseBroll(p, shot, { start: 4, end: 6 }), /narration cut/);
  assert.throws(() => reviseBroll(p, shot, { srcStart: 4 }), /exceeds|sampled/);
  assert.throws(() => reviseBroll({ ...p, broll: [{ ...shot, id: "other" }] }, shot, {}), /overlap/);
});

test("saving uses the server revision, preserves newer local edits and keeps undo history", async () => {
  const gate = deferred();
  let sent;
  const h = harness({ getPlan: async (id) => ({ editPlan: plan(id), revision: 4, updatedAt: 100 }), savePlan: async (id, revision, editPlan) => { sent = { id, revision, editPlan }; await gate.promise; return { editPlan, revision: 5, updatedAt: 200 }; } });
  const id = await h.actions.generate();
  h.actions.override(id, { hookText: "First edit" });
  const saving = h.actions.savePlan(id);
  await tick();
  h.actions.override(id, { hookText: "Changed while saving" });
  gate.resolve();
  await saving;
  const entry = h.getState().plans[id];
  assert.equal(sent.revision, 4);
  assert.equal(sent.editPlan.hookText, "First edit");
  assert.equal(entry.savedPlan.hookText, "First edit");
  assert.equal(h.usePlan(id).plan.hookText, "Changed while saving");
  assert.equal(entry.revision, 5);
  assert.equal(entry.past.length, 2);
  h.actions.undo(id);
  assert.equal(h.usePlan(id).plan.hookText, "First edit");
});

test("save conflicts preserve the local draft and reloading the server version is undoable", async () => {
  const h = harness({ getPlan: async (id) => ({ editPlan: { ...plan(id), hookText: "Elsewhere" }, revision: 2, updatedAt: 200 }), savePlan: async () => { throw new Error("Must not overwrite a newer remote edit"); } });
  const id = await h.actions.generate();
  h.actions.override(id, { hookText: "My local draft" });
  await h.actions.savePlan(id);
  assert.equal(h.getState().plans[id].save.status, "conflict");
  assert.equal(h.usePlan(id).plan.hookText, "My local draft");
  await h.actions.reloadSavedPlan(id);
  assert.equal(h.usePlan(id).plan.hookText, "Elsewhere");
  h.actions.undo(id);
  assert.equal(h.usePlan(id).plan.hookText, "My local draft");
});

test("export reviews match only the same saved preview and transformed render settings", () => {
  const h = harness();
  const { exportPreview, reviewMatches } = h.load("export-plan.ts");
  const p = plan("reviewed");
  const output = exportPreview(p, "720p", false);
  assert.equal(output.width, 720);
  assert.equal(output.height, 1280);
  assert.equal(output.captions.enabled, false);
  assert.equal(p.captions.enabled, true);
  const record = { submittedFingerprint: "same-preview", submittedInputFingerprint: "same-preview", renderedPlanFingerprint: "actual-render", requestedSettings: { resolution: "720p", burnCaptions: false }, settings: { resolution: "720p", burnCaptions: false }, review: { planFingerprint: "actual-render" } };
  assert.equal(reviewMatches(record, "same-preview", false, false), true);
  assert.equal(reviewMatches(record, "changed-preview", false, false), false);
  assert.equal(reviewMatches(record, "same-preview", true, false), false);
  assert.equal(reviewMatches(record, "same-preview", false, true), false);
  assert.equal(reviewMatches({ ...record, review: { planFingerprint: "other-resolution" } }, "same-preview", false, false), false);
  assert.equal(reviewMatches({ ...record, settings: { resolution: "1080p", burnCaptions: false } }, "same-preview", false, false), false);
  assert.equal(reviewMatches({ ...record, submittedInputFingerprint: "other-request" }, "same-preview", false, false), false);
});

test("legacy or inaccessible server plans preserve local drafts and show actionable recovery", async () => {
  const h = harness({ getPlan: async () => { const error = new Error("Not found"); error.status = 404; throw error; } });
  const id = await h.actions.generate();
  h.actions.override(id, { hookText: "Recoverable draft" });
  await h.actions.ensurePlan(id);
  assert.equal(h.getState().planAccess[id], "error");
  assert.match(h.getState().planErrors[id], /local draft is preserved/);
  assert.equal(h.usePlan(id).plan.hookText, "Recoverable draft");
});

test("reconnection uses durable revisions and disconnect never completes a pending export", () => {
  const h = harness();
  const { reconcileJob, hasJobOutput } = h.load("jobs.ts");
  const pending = { id: "owned-job", state: "running", revision: 3, progress: { fraction: 0.4, stage: "Rendering" }, output: null };
  assert.equal(hasJobOutput(pending), false);
  assert.equal(reconcileJob(pending, { ...pending, revision: 2, progress: { fraction: 0.1, stage: "Queued" } }), pending);
  const restored = reconcileJob(pending, { ...pending, revision: 5, state: "succeeded", output: { kind: "video", id: "owned-output" } });
  assert.equal(hasJobOutput(restored), true);
  assert.equal(hasJobOutput({ ...restored, output: null }), false);
  assert.equal(hasJobOutput({ ...pending, cancelRequestedAt: 100 }), false);
  assert.equal(reconcileJob(restored, { ...pending, revision: 6 }), restored);
  assert.throws(() => reconcileJob(pending, { ...pending, id: "different-project" }), /different operation/);
});

test("job watcher reconnects from snapshots without enqueueing or completing a disconnected render", async () => {
  const h = harness({}, new Map(), { "./mock": {} });
  const requests = [];
  const running = { id: "job-one", state: "running", revision: 3, progress: { fraction: 0.3, stage: "Rendering" }, output: null };
  h.context.fetch = async (url, options) => {
    requests.push({ url, method: options?.method ?? "GET" });
    return url.includes("/events") ? new Response(`id: 4\nevent: job\ndata: ${JSON.stringify({ ...running, revision: 4 })}\n\n`) : Response.json({ job: running });
  };
  const api = h.load("api.ts");
  const seen = [];
  await assert.rejects(async () => { for await (const job of api.watchJob("job-one", 2, new AbortController().signal)) seen.push(job); }, /disconnected/);
  assert.equal(seen.at(-1).state, "running");
  assert.equal(seen.at(-1).revision, 4);
  assert.ok(requests.every((r) => r.method === "GET"));
  assert.match(requests[1].url, /after=3/);
  h.context.fetch = async () => Response.json({ job: { ...running, revision: 8, state: "succeeded", output: { kind: "video", id: "result-one" } } });
  const resumed = [];
  for await (const job of api.watchJob("job-one", 4, new AbortController().signal)) resumed.push(job);
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].state, "succeeded");
  h.context.fetch = async () => Response.json({});
  await assert.rejects(api.getExportResult("job-one"), /no downloadable video/);
});

test("durable export associations persist only job references and do not clear a newer job", () => {
  const h = harness();
  const association = { jobId: "first", cursor: 3, submittedFingerprint: "preview", requestedSettings: { resolution: "720p", burnCaptions: true } };
  h.actions.trackExportJob("edit", association);
  h.flush();
  const restored = harness({}, h.storage);
  assert.equal(restored.getState().exportJobs.edit.jobId, "first");
  assert.equal(restored.getState().reviews.edit, undefined);
  restored.actions.trackExportJob("edit", { ...association, jobId: "next", cursor: 1 });
  restored.actions.clearExportJob("edit", "first");
  assert.equal(restored.getState().exportJobs.edit.jobId, "next");
});

test("undo across a remix restores the server revision belonging to that saved plan", async () => {
  const saved = new Map();
  const h = harness({
    getPlan: async (id) => saved.get(id) ?? { editPlan: plan(id), revision: 1, updatedAt: 10 },
    savePlan: async (id, revision, editPlan) => { const result = { editPlan, revision: revision + 1, updatedAt: 20 }; saved.set(id, result); return result; },
    async *remix() { yield { type: "plan", editPlan: plan("remixed-plan"), stats }; },
  });
  const id = await h.actions.generate();
  h.actions.override(id, { hookText: "Saved before remix" });
  await h.actions.savePlan(id);
  assert.equal(h.getState().plans[id].revision, 2);
  await h.actions.remix(id, "Change the pacing");
  assert.equal(h.getState().plans[id].serverId, "remixed-plan");
  assert.equal(h.getState().plans[id].revision, undefined);
  h.actions.undo(id);
  assert.equal(h.getState().plans[id].serverId, id);
  assert.equal(h.getState().plans[id].revision, 2);
  assert.equal(h.usePlan(id).plan.hookText, "Saved before remix");
  h.actions.redo(id);
  await h.actions.savePlan(id);
  assert.equal(h.getState().plans[id].serverId, "remixed-plan");
  assert.equal(h.getState().plans[id].revision, 2);
});

test("remix receives the effective unsaved preview and keeps it while the response is pending", async () => {
  const gate = deferred();
  let request;
  const h = harness({ async *remix(args) { request = args; await gate.promise; yield { type: "plan", editPlan: plan("accepted-remix"), stats }; } });
  const id = await h.actions.generate();
  const asset = supportingFixture();
  const shot = h.load("broll.ts").newBroll({ ...h.usePlan(id).plan, supporting: [asset] }, asset, 1);
  const design = { typeface: "serif", fontScale: 0.8, weight: "regular", textColor: "#FFFFFF", highlightMode: "none", animation: "none", outline: false };
  h.actions.override(id, { supporting: [asset], broll: [shot], captionDesign: design, hookText: "Manual context" });
  const before = h.usePlan(id).plan;
  const pending = h.actions.remix(id, "Keep this context and tighten the opening");
  await tick();
  assert.equal(request.editPlan.hookText, "Manual context");
  assert.equal(request.editPlan.broll[0].assetId, "detail");
  assert.equal(request.editPlan.captions.design.typeface, "serif");
  assert.equal(h.usePlan(id).plan, before);
  gate.resolve(); await pending;
  h.actions.undo(id);
  assert.equal(h.usePlan(id).plan.broll[0].id, shot.id);
});

test("preview readiness waits for a decoded paused seek and reports real media failures", () => {
  const h = harness();
  const { previewReadiness } = h.load("preview-readiness.ts");
  const decoded = { readyState: 4, seeking: false, error: null };
  assert.equal(previewReadiness([]), "loading");
  assert.equal(previewReadiness([decoded, { readyState: 1, seeking: true, error: null }]), "loading");
  assert.equal(previewReadiness([{ ...decoded, seeking: true }]), "loading");
  assert.equal(previewReadiness([decoded, { ...decoded, readyState: 2 }]), "ready");
  assert.equal(previewReadiness([decoded, { ...decoded, error: { code: 4 } }]), "error");
});

test("a rate-limited run retains the uploaded draft and never marks a missing plan complete", async () => {
  let requests = 0;
  const h = harness({ uploadSupporting: async () => ({ videoId: "detail-busy" }), async *generateVariants() {
    requests++;
    yield { type: "start" };
    yield { type: "variant-error", index: 0, message: "The editing service is busy. Try again later.", errorCode: "RATE_LIMITED", retryable: true };
    yield { type: "summary", count: 1, ok: 0 };
  } });
  await h.actions.upload({ name: "my-real-clip.mp4", type: "video/mp4" });
  await h.actions.uploadSupporting("upload", { name: "detail.mp4", type: "video/mp4" });
  h.actions.setPrompt("Keep the real reaction");
  await h.actions.generate();
  const state = h.getState();
  assert.equal(requests, 1);
  assert.equal(state.run.status, "error");
  assert.equal(state.run.errorCode, "RATE_LIMITED");
  assert.equal(state.run.retryable, true);
  assert.equal(state.run.slots[0], null);
  assert.equal(state.project.fileName, "my-real-clip.mp4");
  assert.equal(state.project.prompt, "Keep the real reaction");
  assert.equal(state.supporting.upload[0].asset.videoId, "detail-busy");
  assert.equal(Object.keys(state.plans).length, 0);
});

test("provider error titles distinguish actual busy, authentication and invalid-response codes", () => {
  const h = harness();
  const { generationErrorTitle, serviceErrorFields } = h.load("errors.ts");
  assert.match(generationErrorTitle({ status: "error", errorCode: "RATE_LIMITED" }), /busy/);
  assert.match(generationErrorTitle({ status: "error", errorCode: "UNAVAILABLE" }), /unavailable/);
  assert.match(generationErrorTitle({ status: "error", errorCode: "AUTH_REJECTED" }), /connection/i);
  assert.doesNotMatch(generationErrorTitle({ status: "error", errorCode: "INVALID_RESPONSE" }), /busy|key/);
  assert.equal(generationErrorTitle({ status: "error", interrupted: true }), "Request interrupted");
  assert.equal(serviceErrorFields({ errorCode: "REQUEST_FAILED", retryable: true }).errorCode, undefined);
  assert.equal(serviceErrorFields({ code: "RATE_LIMITED", retryable: true }).retryable, undefined);
});

test("a generic non-retryable failure keeps the draft without inventing a provider code", async () => {
  let requests = 0;
  const h = harness({ async *generateVariants() {
    requests++;
    yield { type: "variant-error", index: 0, message: "Couldn't create this edit.", retryable: false };
    yield { type: "summary", count: 1, ok: 0 };
  } });
  await h.actions.upload({ name: "kelly.webm", type: "video/webm" });
  h.actions.setPrompt("Keep the original thought");
  await h.actions.generate();
  const state = h.getState();
  assert.equal(requests, 1);
  assert.equal(state.run.status, "error");
  assert.equal(state.run.retryable, false);
  assert.equal(state.run.errorCode, undefined);
  assert.equal(state.run.slots[0], null);
  assert.equal(state.project.fileName, "kelly.webm");
  assert.equal(state.project.prompt, "Keep the original thought");
  const { serviceErrorFields } = h.load("errors.ts");
  assert.deepEqual({ ...serviceErrorFields({ errorCode: "REQUEST_FAILED", retryable: false }) }, { retryable: false });
  assert.equal(serviceErrorFields({ errorCode: "REQUEST_FAILED", retryable: true }).retryable, undefined);
});

test("the alternate drawer blocks interrupted and non-retryable replays but keeps explicit safe actions", () => {
  const h = harness();
  const calls = [];
  const drawerState = { altRoot: {}, alts: {}, plans: { root: { base: plan("root") } } };
  const imports = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react": { useEffect() {}, useState: () => [0, () => {}] },
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "@/lib/client/store": {
      useStore: (select) => select(drawerState),
      isActive: h.isActive,
      actions: { generateAlternates: (id) => calls.push(id), cancel() {} },
    },
    "@/components/ui/Button": { Button: "test-button" },
    "@/components/ui/Panel": { Panel: "test-panel" },
    "@/components/ui/Shimmer": { Shimmer: "test-shimmer" },
    "@/components/ui/Skeleton": { Skeleton: "test-skeleton" },
    "@/components/ui/icons": { IconSparkle: "test-icon", IconX: "test-icon" },
    "../ui": { cx: (...values) => values.filter(Boolean).join(" ") },
  };
  const file = resolve(here, "../../components/app/studio/AlternatesDrawer.tsx");
  const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {})(name => {
    assert.ok(name in imports, `Unexpected drawer import: ${name}`);
    return imports[name];
  }, loaded, loaded.exports);
  const walk = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
  const text = (node) => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : "";
  function generationButton(run) {
    drawerState.alts.root = run ? { slots: [], slotErrors: [], ...run } : undefined;
    const tree = loaded.exports.AlternatesDrawer({ id: "root", frames: [], onClose() {} });
    return walk(tree).find(node => node.type === "test-button" && /^(Make three|Three more|Retry|Try again later)$/.test(text(node.props.children).trim()));
  }
  for (const run of [
    { status: "error", interrupted: true },
    { status: "done", interrupted: true, slots: ["earlier"] },
    { status: "error", retryable: false },
    { status: "done", retryable: false, slots: ["earlier"] },
    { status: "error", errorCode: "AUTH_REJECTED" },
    { status: "queued" },
  ]) assert.equal(generationButton(run), undefined);
  assert.equal(calls.length, 0);
  for (const [run, label] of [
    [undefined, "Make three"],
    [{ status: "done", slots: [] }, "Three more"],
    [{ status: "cancelled", slots: [] }, "Three more"],
    [{ status: "error", errorCode: "RATE_LIMITED", retryable: true }, "Try again later"],
    [{ status: "error", errorCode: "UNAVAILABLE", retryable: true }, "Try again later"],
  ]) {
    const before = calls.length;
    const button = generationButton(run);
    assert.equal(text(button.props.children).trim(), label);
    assert.equal(calls.length, before);
    button.props.onClick();
    assert.equal(calls.length, before + 1);
  }
  assert.deepEqual(calls, ["root", "root", "root", "root", "root"]);
});

test("an authentication-rejected remix preserves the preview and safe error classification", async () => {
  const h = harness({ async *remix() { yield { type: "error", message: "The configured connection was rejected.", errorCode: "AUTH_REJECTED", retryable: false }; } });
  const id = await h.actions.generate();
  h.actions.override(id, { hookText: "My local hook" });
  await h.actions.remix(id, "Tighten this");
  assert.equal(h.usePlan(id).plan.hookText, "My local hook");
  const reply = h.getState().plans[id].chat.at(-1);
  assert.equal(reply.errorCode, "AUTH_REJECTED");
  assert.equal(reply.retryable, false);
  assert.equal(reply.pending, false);
  assert.match(reply.text, /configured connection was rejected/);
});

test("older reload-cancelled drafts migrate to interrupted without retrying or losing the clip", () => {
  const h = harness();
  const saved = JSON.parse(JSON.stringify(h.getState()));
  saved.project.fileName = "kelly.webm";
  saved.project.videoId = "clean-nasa";
  saved.run = { status: "cancelled", startedAt: 1, slots: [null], slotErrors: [], error: "Interrupted by a reload." };
  h.storage.set("unfold.app.v4", JSON.stringify(saved));
  const restored = harness({}, h.storage);
  assert.equal(restored.getState().run.status, "error");
  assert.equal(restored.getState().run.interrupted, true);
  assert.equal(restored.getState().run.errorCode, undefined);
  assert.equal(restored.getState().project.fileName, "kelly.webm");
  assert.equal(restored.getState().project.videoId, "clean-nasa");
  assert.equal(restored.getState().run.slots[0], null);
});
