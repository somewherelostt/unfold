import assert from "node:assert/strict";
import test from "node:test";
import { compileEditPlan, mapSrcToOut, sampleAgentPlans, sampleAnalysis, sampleLibrary } from "@unfold/core";
import { analyzeStyle, generateVariants, normalizePlan } from "../src/agent";
import { describeClip, describeStyle } from "../src/prompt";

const context = { analysis: sampleAnalysis, library: sampleLibrary };

test("a quiet plan stays quiet instead of receiving automatic music and bold captions", () => {
  const plan = normalizePlan({ music: null }, context);
  assert.equal(plan.music, null);
  assert.equal(plan.style, "custom");
  assert.equal(plan.hookText, null);
  assert.equal(plan.captions.preset, "clean-pop");
  assert.equal(plan.captions.uppercase, false);
  assert.equal(plan.captions.position, "lower");
  assert.deepEqual([plan.transitions, plan.zooms, plan.sfx, plan.overlays], [[], [], [], []]);
  assert.equal(normalizePlan({ music: { trackId: "missing" } }, context).music, null);
  assert.equal(normalizePlan({}, { ...context, analysis: { ...sampleAnalysis, hasSpeech: false, words: [] } }).captions.enabled, false);
});

test("music defaults under dialogue are restrained while explicit creative choices survive", () => {
  const quiet = normalizePlan({ music: { trackId: sampleLibrary.music[0].id } }, context);
  assert.equal(quiet.music?.volume, 0.12);
  assert.equal(quiet.music?.snapCutsToBeats, false);
  const expressive = normalizePlan(sampleAgentPlans[0], context);
  assert.equal(expressive.style, "chaos");
  assert.equal(expressive.music?.volume, sampleAgentPlans[0].music?.volume);
  assert.equal(expressive.music?.snapCutsToBeats, true);
  assert.equal(expressive.captions.uppercase, true);
  assert.equal(expressive.captions.preset, "meme");
});

test("valid custom typography survives normalization and compilation", () => {
  const plan = normalizePlan({ captions: { design: { typeface: "serif", fontScale: 0.8, weight: "regular", textColor: "#EEEEEE", highlightMode: "none", animation: "none", outline: false } } }, context);
  assert.equal(plan.captions.design?.typeface, "serif");
  assert.equal(plan.captions.design?.fontScale, 0.8);
  assert.deepEqual(compileEditPlan(plan, sampleAnalysis, sampleLibrary).captions.design, plan.captions.design);
  assert.equal(normalizePlan({ captions: { design: { typeface: "missing" } } }, context).captions.design, undefined);
});

test("invalid event times are discarded instead of being clamped onto a different moment", () => {
  const plan = normalizePlan({
    sfx: [{ srcTime: -1, sfxId: "ding" }, { srcTime: sampleAnalysis.durationSec, sfxId: "ding" }],
    zooms: [{ srcTime: Number.POSITIVE_INFINITY }],
    overlays: [{ srcTime: -2, text: "Unrelated" }],
  }, context);
  assert.deepEqual([plan.sfx, plan.zooms, plan.overlays], [[], [], []]);
});

test("single-edit generation uses adaptive direction and labels only the frames actually attached", async () => {
  const previous = globalThis.fetch;
  const requests: { messages: { content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] }[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const chunk = { choices: [{ delta: { content: JSON.stringify(sampleAgentPlans[1]) } }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  try {
    const results = [];
    for await (const result of generateVariants({
      ...context,
      analysis: { ...sampleAnalysis, frames: Array.from({ length: 10 }, (_, i) => ({ t: i * 2, url: `/frame-${i * 2}.jpg` })) },
      maxFrames: 3,
      loadFrame: async (url) => {
        if (url === "/frame-8.jpg") throw new Error("missing image");
        return `data:image/jpeg;base64,${url}`;
      },
      config: { url: "https://agent-test.invalid", token: "test", agentId: "test" },
    }, "Keep the explanation natural", { count: 1 })) results.push(result);
    assert.equal(results[0].error, undefined);
    assert.equal(requests.length, 1);
    assert.match(String(requests[0].messages.at(-1)?.content), /THIS VARIANT: Adaptive edit:/);
    const evidence = requests[0].messages[1].content;
    assert.ok(Array.isArray(evidence));
    assert.match(evidence[0].text!, /FRAMES: 2 images attached in time order at seconds 0, 16/);
    assert.deepEqual(evidence.filter((part) => part.type === "image_url").map((part) => part.image_url?.url), ["data:image/jpeg;base64,/frame-0.jpg", "data:image/jpeg;base64,/frame-16.jpg"]);
  } finally {
    globalThis.fetch = previous;
  }
});

test("cues on removed moments are dropped instead of attached to unrelated footage", () => {
  const plan = compileEditPlan({
    ...sampleAgentPlans[1], music: null, transitions: [],
    segments: [{ srcStart: 0, srcEnd: 2, speed: 1 }, { srcStart: 4, srcEnd: 6, speed: 1 }],
    zooms: [3, 4.5, 6].map((srcTime) => ({ srcTime, kind: "punch", scale: 1.2 })),
    sfx: [3, 4.5, 6].map((srcTime) => ({ srcTime, sfxId: "ding", volume: 0.2 })),
    overlays: [3, 4.5, 6].map((srcTime) => ({ srcTime, text: "Detail", durationSec: 0.5 })),
  }, sampleAnalysis, sampleLibrary);
  assert.deepEqual(plan.zooms.map((cue) => cue.start), [2.5]);
  assert.deepEqual(plan.sfx.map((cue) => cue.at), [2.5]);
  assert.deepEqual(plan.overlays.map((cue) => cue.start), [2.5]);
});

test("beat snapping cannot remove spoken words but still aligns a silent boundary", () => {
  const library = { ...sampleLibrary, music: [{ ...sampleLibrary.music[0], beats: [0, 2, 4, 6, 8], downbeats: [0], dropAt: null }] };
  const request = { ...sampleAgentPlans[1], segments: [{ srcStart: 0, srcEnd: 2.2, speed: 1 }, { srcStart: 4, srcEnd: 6, speed: 1 }], music: { trackId: library.music[0].id, volume: 0.12, snapCutsToBeats: true, alignDropToSrc: null } };
  const analysis = { ...sampleAnalysis, words: [{ text: "important", start: 2.05, end: 2.18 }] };
  assert.equal(compileEditPlan(request, analysis, library).clips[0].srcEnd, 2.2);
  assert.equal(compileEditPlan(request, { ...analysis, hasSpeech: false, words: [] }, library).clips[0].srcEnd, 2);
});

test("the selected music drop follows the final source moment after snapping", () => {
  const library = { ...sampleLibrary, music: [{ ...sampleLibrary.music[0], beats: Array.from({ length: 20 }, (_, i) => i), downbeats: [0], dropAt: 5 }] };
  const request = { ...sampleAgentPlans[1], segments: [{ srcStart: 0, srcEnd: 2.2, speed: 1 }, { srcStart: 4, srcEnd: 6, speed: 1 }], music: { trackId: library.music[0].id, volume: 0.12, snapCutsToBeats: true, alignDropToSrc: 4.3 } };
  const plan = compileEditPlan(request, { ...sampleAnalysis, hasSpeech: false, words: [] }, library);
  assert.equal(plan.clips[0].srcEnd, 2.5);
  assert.ok(Math.abs(plan.music!.trackStart + mapSrcToOut(plan.clips, 4.3)! - 5) < 0.001);
});

test("captions follow every occurrence of a source line reused as a cold open", () => {
  const analysis = { ...sampleAnalysis, words: [{ text: "A", start: 0.2, end: 0.4 }, { text: "result.", start: 4.2, end: 4.7 }] };
  const plan = compileEditPlan({
    ...sampleAgentPlans[1], music: null,
    segments: [{ srcStart: 4, srcEnd: 5, speed: 1 }, { srcStart: 0, srcEnd: 5, speed: 1 }],
  }, analysis, sampleLibrary);
  assert.deepEqual(plan.captions.chunks.flatMap((chunk) => chunk.words.map(({ text, start }) => ({ text, start }))), [
    { text: "result.", start: 0.2 },
    { text: "A", start: 1.2 },
    { text: "result.", start: 5.2 },
  ]);
});

test("the planner receives word endings and repairs partial-word boundaries", () => {
  const analysis = { ...sampleAnalysis, words: [
    { text: "heights.", start: 3.36, end: 3.96 },
    { text: "Teamwork", start: 3.96, end: 4.44 },
    { text: "matters.", start: 4.44, end: 5.28 },
  ] };
  assert.match(describeClip(analysis), /3\.96-4\.44 Teamwork/);
  const request = { segments: [{ srcStart: 3.9, srcEnd: 4.7, speed: 1 }] };
  const normalized = normalizePlan(request, { ...context, analysis });
  assert.deepEqual(normalized.segments, [{ srcStart: 3.96, srcEnd: 5.28, speed: 1 }]);
  const edit = compileEditPlan(normalized, analysis, sampleLibrary);
  assert.deepEqual(edit.captions.chunks.flatMap((c) => c.words.map((w) => w.text)), ["Teamwork", "matters."]);
  assert.deepEqual(normalizePlan(request, { ...context, analysis: { ...analysis, hasSpeech: false } }).segments, request.segments);
});

test("visual references cannot manufacture music or sound-effect evidence", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    const chunk = { choices: [{ delta: { content: JSON.stringify({ sfxDensityPerMin: 8, musicEnergy: 1, musicMoods: ["hype"] }) } }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  try {
    const { profile } = await analyzeStyle({ ...sampleAnalysis, frames: [] }, async () => "", { cutsPerMinute: 5, avgShotSec: 12 }, { url: "https://agent-test.invalid", token: "test", agentId: "test" });
    assert.deepEqual([profile.sfxDensityPerMin, profile.musicEnergy, profile.musicMoods], [0, 0, []]);
    assert.equal(profile.captions.preset, "clean-pop");
    assert.equal(profile.captions.uppercase, false);
    assert.equal(profile.zoomIntensity, 0);
    assert.match(describeStyle(profile), /Reference audio was not inspected/);
    assert.doesNotMatch(describeStyle(profile), /music energy|SFX \d/);
  } finally {
    globalThis.fetch = previous;
  }
});
