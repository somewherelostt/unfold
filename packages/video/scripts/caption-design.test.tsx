import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";
import React from "react";
import { CaptionDesign, compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary, type EditPlan } from "@unfold/core";
import { activeCaptionWord, CAPTION_DESIGNS, hookRepeatsOpening, resolveCaptionDesign } from "../src/captionDesign";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: React.ReactNode): string };
const remotion = await import("remotion");
mock.module("remotion", { exports: { ...remotion, useCurrentFrame: () => 15, AbsoluteFill: ({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) => <div style={style}>{children}</div> } });
const { Hook } = await import("../src/layers/TextPops");
const { Captions } = await import("../src/layers/Captions");

const source = compileEditPlan(sampleAgentPlans[0], sampleAnalysis, sampleLibrary);
const captionPlan = (preset: EditPlan["captions"]["preset"] = "clean-pop"): EditPlan => ({
  ...source,
  style: "chaos",
  hookText: "An actual different title",
  captions: { ...source.captions, preset, enabled: true, position: "lower", uppercase: false, chunks: [{ start: 0, end: 2, words: [
    { text: "Keep", start: 0, end: 0.3, emphasis: false },
    { text: "this", start: 0.35, end: 0.6, emphasis: false },
    { text: "natural.", start: 0.65, end: 1.2, emphasis: true },
  ] }] },
});

test("clean, editorial and karaoke have distinct typography and restrained defaults", () => {
  const clean = resolveCaptionDesign({ preset: "clean-pop" });
  const story = resolveCaptionDesign({ preset: "story" });
  const karaoke = resolveCaptionDesign({ preset: "karaoke" });
  assert.notEqual(clean.family, story.family);
  assert.notEqual(clean.fontWeight, story.fontWeight);
  assert.equal(story.highlightMode, "none");
  assert.equal(karaoke.highlightMode, "background");
  for (const look of [clean, story, karaoke]) {
    assert.equal(look.stroke, 0);
    assert.ok(look.size <= 72);
    assert.ok(look.fontWeight <= 600);
    assert.notEqual(look.animation, "pop");
  }
});

test("per-video design parameters survive compilation and control the renderer", () => {
  const design = CaptionDesign.parse({ typeface: "serif", fontScale: 0.8, weight: "regular", textColor: "#ECE8DF", highlightMode: "none", animation: "none", outline: false });
  const compiled = compileEditPlan({ ...sampleAgentPlans[0], captions: { ...sampleAgentPlans[0].captions, design } }, sampleAnalysis, sampleLibrary);
  assert.deepEqual(compiled.captions.design, design);
  const look = resolveCaptionDesign(compiled.captions);
  assert.equal(look.fontWeight, 400);
  assert.equal(look.highlightMode, "none");
  assert.equal(look.animation, "none");
  assert.equal(look.textColor, "#ECE8DF");
  assert.equal(look.size, 108 * 0.8);
});

test("changing a style label cannot override caption or hook design", () => {
  const plan = captionPlan();
  const hook = renderToStaticMarkup(<Hook plan={plan} />);
  const body = renderToStaticMarkup(<Captions plan={plan} />);
  assert.ok(hook.includes("An actual different title"));
  for (const style of ["custom", "storytime", "podcast-clip", "gaming-montage"] as const) {
    assert.equal(renderToStaticMarkup(<Hook plan={{ ...plan, style }} />), hook);
    assert.equal(renderToStaticMarkup(<Captions plan={{ ...plan, style }} />), body);
  }
});

test("duplicate hook text is suppressed instead of stacking a second opening caption", () => {
  const plan = { ...captionPlan(), hookText: "KEEP THIS NATURAL!" };
  assert.equal(hookRepeatsOpening(plan), true);
  assert.equal(renderToStaticMarkup(<Hook plan={plan} />), "");
  assert.equal(hookRepeatsOpening({ ...plan, hookText: "A new perspective" }), false);
  assert.equal(hookRepeatsOpening({ ...plan, hookText: null }), false);
});

test("the current word remains highlighted between spoken word timestamps", () => {
  const words = [{ start: 0.2 }, { start: 0.8 }, { start: 1.4 }];
  assert.equal(activeCaptionWord(words, 0.1), -1);
  assert.equal(activeCaptionWord(words, 0.7), 0);
  assert.equal(activeCaptionWord(words, 0.8), 1);
  assert.equal(activeCaptionWord(words, 1.3), 1);
});

test("readable styles retain punctuation and case without adding a camera filter", () => {
  for (const preset of ["clean-pop", "story", "karaoke"] as const) {
    const html = renderToStaticMarkup(<Captions plan={captionPlan(preset)} />);
    assert.ok(html.includes("natural."));
    assert.doesNotMatch(html, /text-transform:uppercase|linear-gradient|rotate\(|blur\(/);
  }
  assert.equal(CAPTION_DESIGNS.meme.outline, true);
  assert.equal(CAPTION_DESIGNS["bold-pop"].animation, "pop");
});
