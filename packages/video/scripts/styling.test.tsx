import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";
import React from "react";
import { compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary, type EditPlan } from "@unfold/core";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: React.ReactNode): string };
let frame = 12;
const remotion = await import("remotion");
mock.module("remotion", {
  exports: {
    ...remotion,
    useCurrentFrame: () => frame,
    getRemotionEnvironment: () => ({ isPlayer: true }),
    AbsoluteFill: ({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) => <div style={style}>{children}</div>,
    Sequence: ({ children }: React.PropsWithChildren) => <>{children}</>,
    OffthreadVideo: () => <video />,
    Audio: () => null,
  },
});

const { computeFx } = await import("../src/fx");
const { UnfoldComposition } = await import("../src/UnfoldComposition");
const { Hook, Overlays } = await import("../src/layers/TextPops");
const { Captions } = await import("../src/layers/Captions");
const source = compileEditPlan(sampleAgentPlans[0], sampleAnalysis, sampleLibrary);
const styles: EditPlan["style"][] = ["custom", "storytime", "podcast-clip", "chaos", "gaming-montage"];
const identity = { scale: 1, tx: 0, ty: 0, rot: 0, blurX: 0, blurY: 0, blur: 0, rgb: 0, glitch: 0, flash: 0, brightness: 1 };
const neutralPlan = (style: EditPlan["style"]): EditPlan => ({
  ...source,
  style,
  hookText: null,
  captions: { ...source.captions, enabled: false },
  transitions: [],
  zooms: [],
  sfx: [],
  overlays: [],
  music: { ...source.music!, beats: [0, 0.5, 1] },
});

test("empty effect tracks preserve camera motion and source appearance for every style", () => {
  for (const style of styles) {
    const plan = neutralPlan(style);
    for (const f of [0, 1, 15, 16, 30]) assert.deepEqual(computeFx(plan, f / plan.fps, f), identity, `${style} at frame ${f}`);
    const html = renderToStaticMarkup(<UnfoldComposition plan={plan} />);
    assert.doesNotMatch(html, /saturate\(|contrast\(|radial-gradient\(|linear-gradient\(|filter:/, style);
  }
});

test("explicit zooms and transition effects still run on quiet plans", () => {
  const plan = neutralPlan("custom");
  assert.ok(computeFx({ ...plan, zooms: [{ start: 0, end: 1, kind: "slow-push", scale: 1.2 }] }, 0.5, 15).scale > 1);
  for (const type of ["whip", "zoom-punch", "flash", "shake", "glitch", "slide"] as const) {
    assert.notDeepEqual(computeFx({ ...plan, transitions: [{ at: 1, durationSec: 0.3, type }] }, 1, 30), identity, type);
  }
});

test("quiet hooks and overlays retain their case without slam or shake", () => {
  frame = 5;
  for (const style of ["custom", "storytime", "podcast-clip"] as const) {
    const plan: EditPlan = {
      ...neutralPlan(style),
      hookText: "Keep this Natural.",
      captions: { ...source.captions, preset: "clean-pop", uppercase: false },
      overlays: [{ start: 0, end: 2, text: "A useful Detail." }],
    };
    for (const [component, text] of [[Hook, plan.hookText!], [Overlays, plan.overlays[0].text]] as const) {
      const html = renderToStaticMarkup(React.createElement(component, { plan }));
      assert.ok(html.includes(text), style);
      assert.doesNotMatch(html, /rotate\(|scale\(|filter:blur\(/, style);
      for (const match of html.matchAll(/translateY\(([-\d.]+)px\)/g)) assert.ok(Math.abs(Number(match[1])) <= 8, style);
      for (const match of html.matchAll(/font-size:([\d.]+)px/g)) assert.ok(Number(match[1]) <= 96, style);
    }
  }
});

test("explicit bold designs keep uppercase hooks and deliberate entrance motion", () => {
  frame = 5;
  for (const style of ["chaos", "gaming-montage"] as const) {
    const plan = { ...neutralPlan(style), hookText: "Make it bold", captions: { ...source.captions, preset: "bold-pop" as const, uppercase: true } };
    const html = renderToStaticMarkup(<Hook plan={plan} />);
    assert.match(html.replace(/<[^>]*>/g, ""), /MAKE.*BOLD/);
    assert.ok([...html.matchAll(/font-size:([\d.]+)px/g)].some((match) => Number(match[1]) >= 80));
    assert.match(html, /transform:scale\(/);
  }
});

const captionPlan = (preset: EditPlan["captions"]["preset"], position: EditPlan["captions"]["position"]): EditPlan => ({
  ...neutralPlan("custom"),
  captions: {
    ...source.captions,
    enabled: true,
    preset,
    position,
    uppercase: false,
    chunks: [{ start: 0, end: 2, words: [
      { text: "Hello,", start: 0, end: 0.4, emphasis: false },
      { text: "world.", start: 0.8, end: 1.2, emphasis: true },
    ] }],
  },
});

test("story captions honor upper, center and lower positions without moving or dimming words", () => {
  frame = 12;
  for (const position of ["upper", "center", "lower"] as const) {
    const plan = captionPlan("story", position);
    const html = renderToStaticMarkup(<Captions plan={plan} />);
    const styles = [...html.matchAll(/style="([^"]*)"/g)].map((match) => Object.fromEntries(match[1].split(";").map((declaration) => declaration.split(/:(.*)/s).slice(0, 2))));
    const box = styles.find((style) => style.position === "absolute" && style["justify-content"] === "center")!;
    const line = styles.find((style) => style["font-family"]);
    if (position === "center") assert.equal(Number.parseFloat(box.top), plan.height / 2);
    else if (position === "upper") assert.ok(Number.parseFloat(box.top) < plan.height / 3 && box.bottom === undefined);
    else assert.ok(Number.parseFloat(box.bottom) < plan.height / 3 && box.top === undefined);
    assert.ok(line?.transform === undefined || line.transform === "translateY(0px)");
    assert.doesNotMatch(html, /linear-gradient\(|opacity:0\.55/);
    assert.equal([...html.matchAll(/font-size:([\d.]+)px/g)].length, 1);
  }
});

test("story and clean captions retain punctuation and the selected case", () => {
  frame = 12;
  for (const preset of ["story", "clean-pop"] as const) {
    const plan = captionPlan(preset, "lower");
    const html = renderToStaticMarkup(<Captions plan={plan} />);
    assert.ok(html.includes("Hello,"), preset);
    assert.ok(html.includes("world."), preset);
    const uppercase = renderToStaticMarkup(<Captions plan={{ ...plan, captions: { ...plan.captions, uppercase: true } }} />);
    assert.ok(uppercase.includes("HELLO,"), preset);
    assert.ok(uppercase.includes("WORLD."), preset);
  }
});
