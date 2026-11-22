import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";
import React from "react";
import { compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary, type EditPlan } from "@unfold/core";
import { resolveBrollPlacements } from "../src/broll";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: React.ReactNode): string };
let frame = 0;
const remotion = await import("remotion");
mock.module("remotion", { exports: { ...remotion,
  useCurrentFrame: () => frame,
  getRemotionEnvironment: () => ({ isPlayer: true }),
  AbsoluteFill: ({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) => <div style={style}>{children}</div>,
  Sequence: ({ children, from, durationInFrames }: React.PropsWithChildren<{ from: number; durationInFrames: number }>) => frame >= from && frame < from + durationInFrames ? <>{children}</> : null,
  OffthreadVideo: ({ src, muted, volume, trimBefore, trimAfter, playbackRate, style }: { src: string; muted?: boolean; volume?: number | ((f: number) => number); trimBefore?: number; trimAfter?: number; playbackRate?: number; style?: React.CSSProperties }) => <video data-src={src} data-muted={!!muted} data-volume={typeof volume === "function" ? volume(frame) : volume} data-before={trimBefore} data-after={trimAfter} data-rate={playbackRate} style={style} />,
  Audio: () => null,
} });
const { UnfoldComposition } = await import("../src/UnfoldComposition");
const base = compileEditPlan({ ...sampleAgentPlans[1], music: null, hookText: null, segments: [{ srcStart: 0, srcEnd: 8, speed: 1 }], captions: { ...sampleAgentPlans[1].captions, enabled: false }, zooms: [], sfx: [] }, sampleAnalysis, sampleLibrary);
const plan: EditPlan = { ...base, supporting: [
  { videoId: "a", name: "Detail", description: "", src: "/support-a.mp4", width: 1920, height: 1080, durationSec: 4, frames: [{ t: 1, url: "/a.jpg" }] },
  { videoId: "b", name: "Context", description: "", src: "https://media.local/support-b.mp4?cap=test-only", width: 1080, height: 1920, durationSec: 4, frames: [{ t: 0, url: "/b.jpg" }] },
], broll: [
  { id: "b0", assetId: "a", srcStart: 1, srcEnd: 2, segmentIndex: 0, atSrcTime: 2, evidenceFrameTime: 1, purpose: "explanation", reason: "Show the selected detail.", clipId: "c0", start: 2, end: 3 },
  { id: "b1", assetId: "b", srcStart: 0, srcEnd: 1, segmentIndex: 0, atSrcTime: 5, evidenceFrameTime: 0, purpose: "context", reason: "Show the wider context.", clipId: "c0", start: 5, end: 6, fit: "contain" },
] };

test("supporting placements trim at normal speed and honor cover/contain", () => {
  const placements = resolveBrollPlacements(plan);
  assert.deepEqual(placements.map((p) => [p.from, p.to, p.trimBefore, p.fit]), [[60, 90, 30, "cover"], [150, 180, 0, "contain"]]);
});

test("cutaways are muted while narration remains mounted before, during and after both shots", () => {
  for (const [at, expected] of [[59, null], [60, "/support-a.mp4"], [89, "/support-a.mp4"], [90, null], [150, "https://media.local/support-b.mp4?cap=test-only"], [180, null]] as const) {
    frame = at;
    const html = renderToStaticMarkup(<UnfoldComposition plan={plan} />);
    assert.match(html, /data-src="\/demo\/sample.mp4" data-muted="false" data-volume="1"/);
    const supporting = [...html.matchAll(/<video[^>]*data-muted="true"[^>]*>/g)].map((match) => match[0]);
    assert.equal(supporting.length, expected ? 1 : 0);
    if (expected) { assert.ok(supporting[0].includes(expected)); assert.match(supporting[0], /data-volume="0"/); assert.match(supporting[0], /data-rate="1"/); }
  }
});

test("legacy plans render identically to empty supporting collections", () => {
  frame = 12;
  const { supporting, broll, ...legacy } = base;
  assert.equal(renderToStaticMarkup(<UnfoldComposition plan={legacy} />), renderToStaticMarkup(<UnfoldComposition plan={{ ...legacy, supporting: [], broll: [] }} />));
});

test("missing assets, invalid source ranges and overlapping placements fail visibly", () => {
  assert.throws(() => resolveBrollPlacements({ ...plan, supporting: [] }), /unavailable/);
  assert.throws(() => resolveBrollPlacements({ ...plan, broll: [{ ...plan.broll![0], srcEnd: 8 }] }), /invalid source/);
  assert.throws(() => resolveBrollPlacements({ ...plan, broll: [plan.broll![0], { ...plan.broll![1], start: 2.5, end: 3.5 }] }), /overlap/);
});
