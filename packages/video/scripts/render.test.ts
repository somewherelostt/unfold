import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary } from "@unfold/core";
import { renderPlan } from "../src/render";

type RenderOptions = { cancelSignal: (callback: () => void) => void };
let render: (options: RenderOptions) => Promise<void> = async () => {};
let select: () => Promise<object> = async () => ({});
let bundle: () => Promise<string> = async () => "http://render-check.local";
let cancelCalls = 0;

mock.module("@remotion/renderer", {
  exports: {
    renderMedia: (options: RenderOptions) => render(options),
    selectComposition: () => select(),
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
mock.module("@remotion/bundler", { exports: { bundle: () => bundle() } });

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
