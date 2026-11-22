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
  assert.equal(fresh.getState().run.status, "cancelled");
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
