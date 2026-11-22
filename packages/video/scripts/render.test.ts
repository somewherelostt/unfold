import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock, test } from "node:test";
import { compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary } from "@unfold/core";
import { getServeUrl, renderPlan } from "../src/render";

type RenderOptions = { cancelSignal: (callback: () => void) => void; concurrency: number | null; browserExecutable?: string };
type BundleOptions = { entryPoint: string; publicDir: string; enableCaching?: boolean };
let render: (options: RenderOptions) => Promise<void> = async () => {};
let select: (options?: { browserExecutable?: string }) => Promise<object> = async () => ({});
let bundle: (options: BundleOptions) => Promise<string> = async () => "http://render-check.local";
let cancelCalls = 0;

mock.module("@remotion/renderer", {
  exports: {
    renderMedia: (options: RenderOptions) => render(options),
    selectComposition: (options: { browserExecutable?: string }) => select(options),
    makeCancelSignal: () => {
      const callbacks: (() => void)[] = [];
      let cancelled = false;
      return {
        cancelSignal(callback: () => void) {
          callbacks.push(callback);
          if (cancelled) callback();
        },
        cancel() {
          cancelCalls++;
          cancelled = true;
          callbacks.forEach((callback) => callback());
        },
      };
    },
  },
});
mock.module("@remotion/bundler", { exports: { bundle: (options: BundleOptions) => bundle(options) } });

const plan = compileEditPlan(sampleAgentPlans[0], sampleAnalysis, sampleLibrary);
const options = (name: string, signal: AbortSignal) => ({ publicDir: `/private/tmp/unfold-render-test-${name}`, signal });
const assertCleanedUp = (added: ReturnType<typeof mock.method>, removed: ReturnType<typeof mock.method>) => {
  assert.equal(added.mock.calls.length, 1);
  assert.equal(removed.mock.calls.length, 1);
  assert.equal(added.mock.calls[0].arguments[1], removed.mock.calls[0].arguments[1]);
};

test("a pre-aborted request does not bundle or render", async () => {
  const controller = new AbortController();
  controller.abort();
  bundle = async () => { assert.fail("bundle started"); };
  select = async () => { assert.fail("composition selection started"); };
  render = async () => { assert.fail("render started"); };
  await assert.rejects(renderPlan(plan, "/private/tmp/unused.mp4", options("pre-aborted", controller.signal)), { name: "AbortError" });
});

test("aborting an in-flight render cancels it and releases the listener", async () => {
  const controller = new AbortController();
  const added = mock.method(controller.signal, "addEventListener");
  const removed = mock.method(controller.signal, "removeEventListener");
  cancelCalls = 0;
  bundle = async () => "http://render-check.local";
  select = async () => ({});
  render = ({ cancelSignal }) => new Promise((_, reject) => {
    cancelSignal(() => reject(new Error("render cancelled")));
    controller.abort();
  });

  await assert.rejects(renderPlan(plan, "/private/tmp/unused.mp4", options("in-flight", controller.signal)), { name: "AbortError" });
  assert.equal(cancelCalls, 1);
  assertCleanedUp(added, removed);
});

test("aborting during composition selection prevents CPU rendering", async () => {
  const controller = new AbortController();
  const added = mock.method(controller.signal, "addEventListener");
  const removed = mock.method(controller.signal, "removeEventListener");
  bundle = async () => "http://render-check.local";
  select = async () => { controller.abort(); return {}; };
  render = async () => { assert.fail("render started"); };

  await assert.rejects(renderPlan(plan, "/private/tmp/unused.mp4", options("selection", controller.signal)), { name: "AbortError" });
  assertCleanedUp(added, removed);
});

test("completed and failed exports both release the abort listener", async () => {
  for (const fail of [false, true]) {
    const controller = new AbortController();
    const added = mock.method(controller.signal, "addEventListener");
    const removed = mock.method(controller.signal, "removeEventListener");
    const failure = new Error("render failed");
    bundle = async () => "http://render-check.local";
    select = async () => ({});
    render = async () => { if (fail) throw failure; };
    const result = renderPlan(plan, "/private/tmp/unused.mp4", options(`cleanup-${fail}`, controller.signal));
    if (fail) await assert.rejects(result, failure);
    else assert.equal(await result, "/private/tmp/unused.mp4");
    assertCleanedUp(added, removed);
  }
});

test("exports default to two workers and preserve explicit concurrency overrides", async () => {
  bundle = async () => "http://render-check.local";
  select = async () => ({});
  for (const [requested, expected] of [[undefined, 2], [1, 1], [null, null]] as const) {
    render = async ({ concurrency }) => { assert.equal(concurrency, expected); };
    await renderPlan(plan, "/private/tmp/unused.mp4", { publicDir: "/private/tmp/unfold-render-concurrency", concurrency: requested });
  }
});

test("a provisioned browser is passed to metadata selection and rendering", async () => {
  const executable = new URL(import.meta.url).pathname;
  bundle = async () => "http://render-check.local";
  select = async (options) => { assert.equal(options?.browserExecutable, executable); return {}; };
  render = async (options) => { assert.equal(options.browserExecutable, executable); };
  await renderPlan(plan, "/private/tmp/unused.mp4", { publicDir: "/private/tmp/unfold-browser-test", browserExecutable: executable });
  await assert.rejects(renderPlan(plan, "/private/tmp/unused.mp4", { publicDir: "/private/tmp/unfold-browser-test", browserExecutable: "/private/tmp/nonexistent-unfold-browser" }), /executable does not exist/);
});

function bundleFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "unfold-bundle-test-"));
  const video = path.join(root, "packages/video");
  const core = path.join(root, "packages/core");
  mkdirSync(path.join(video, "src/layers"), { recursive: true });
  mkdirSync(path.join(core, "src"), { recursive: true });
  writeFileSync(path.join(video, "package.json"), JSON.stringify({ name: "@unfold/video" }));
  writeFileSync(path.join(core, "package.json"), JSON.stringify({ name: "@unfold/core" }));
  const entryPoint = path.join(video, "src/entry.ts");
  const caption = path.join(video, "src/layers/Captions.tsx");
  const coreSource = path.join(core, "src/index.ts");
  writeFileSync(entryPoint, 'import "./layers/Captions"; import "@unfold/core";');
  writeFileSync(caption, 'export const treatment = "first";');
  writeFileSync(coreSource, 'export const title = "first";');
  return { root, video, caption, coreSource, options: { entryPoint, publicDir: path.join(root, "public") } };
}

test("unchanged sources reuse a bundle and concurrent callers share the same work", async (t) => {
  const fixture = bundleFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  let calls = 0;
  let release!: (url: string) => void;
  let started!: () => void;
  const bundling = new Promise<void>((resolve) => { started = resolve; });
  bundle = async () => {
    calls++;
    started();
    return new Promise<string>((resolve) => { release = resolve; });
  };

  const first = getServeUrl(fixture.options);
  const concurrent = getServeUrl(fixture.options);
  assert.equal(first, concurrent);
  await bundling;
  assert.equal(calls, 1);
  release("http://bundle.local/first");
  assert.deepEqual(await Promise.all([first, concurrent]), ["http://bundle.local/first", "http://bundle.local/first"]);
  const stat = statSync(fixture.caption);
  utimesSync(fixture.caption, stat.atime, new Date(stat.mtimeMs + 10000));
  assert.equal(await getServeUrl(fixture.options), "http://bundle.local/first");
  assert.equal(calls, 1);
});

test("changed caption content rebuilds even when file size and modification time match", async (t) => {
  const fixture = bundleFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  let calls = 0;
  const builds: BundleOptions[] = [];
  bundle = async (options) => {
    builds.push(options);
    return `http://bundle.local/${++calls}`;
  };
  const before = await getServeUrl(fixture.options);
  const stat = statSync(fixture.caption);
  writeFileSync(fixture.caption, 'export const treatment = "other";');
  utimesSync(fixture.caption, stat.atime, stat.mtime);
  assert.equal(statSync(fixture.caption).size, stat.size);

  assert.notEqual(await getServeUrl(fixture.options), before);
  assert.equal(calls, 2);
  assert.ok(builds.every((options) => options.enableCaching === false));
});

test("imported core changes and newly added or removed renderer sources invalidate the bundle", async (t) => {
  const fixture = bundleFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  let calls = 0;
  bundle = async () => `http://bundle.local/${++calls}`;
  await getServeUrl(fixture.options);
  writeFileSync(fixture.coreSource, 'export const title = "other";');
  assert.equal(await getServeUrl(fixture.options), "http://bundle.local/2");
  const added = path.join(fixture.video, "src/layers/Extra.tsx");
  writeFileSync(added, "export const extra = true;");
  assert.equal(await getServeUrl(fixture.options), "http://bundle.local/3");
  rmSync(added);
  assert.equal(await getServeUrl(fixture.options), "http://bundle.local/4");
  assert.equal(await getServeUrl(fixture.options), "http://bundle.local/4");
  assert.equal(calls, 4);
});

test("an older failed bundle cannot evict a newer source revision", { timeout: 2000 }, async (t) => {
  const fixture = bundleFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  let calls = 0;
  let rejectOld!: (error: Error) => void;
  const failure = new Error("old bundle failed");
  bundle = async () => {
    calls++;
    if (calls === 1) return new Promise<string>((_, reject) => { rejectOld = reject; });
    return "http://bundle.local/new";
  };
  const old = getServeUrl(fixture.options);
  const rejected = assert.rejects(old, failure);
  await new Promise<void>((resolve) => setImmediate(resolve));
  writeFileSync(fixture.caption, 'export const treatment = "other";');
  assert.equal(await getServeUrl(fixture.options), "http://bundle.local/new");
  rejectOld(failure);
  await rejected;
  assert.equal(await getServeUrl(fixture.options), "http://bundle.local/new");
  assert.equal(calls, 2);
});

test("a failed current bundle can be retried without source edits", async (t) => {
  const fixture = bundleFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const failure = new Error("bundle failed");
  let calls = 0;
  bundle = async () => {
    if (++calls === 1) throw failure;
    return "http://bundle.local/retried";
  };
  await assert.rejects(getServeUrl(fixture.options), failure);
  assert.equal(await getServeUrl(fixture.options), "http://bundle.local/retried");
  assert.equal(await getServeUrl(fixture.options), "http://bundle.local/retried");
  assert.equal(calls, 2);
});
