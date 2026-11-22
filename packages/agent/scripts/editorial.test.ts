import assert from "node:assert/strict";
import test from "node:test";
import { AgentPlan, EditPlan, checkEditQuality, compileEditPlan, mapSrcToOut, sampleAgentPlans, sampleAnalysis, sampleLibrary, type SupportingFootage } from "@unfold/core";
import { analyzeStyle, generateVariants, normalizePlan, remixPlan } from "../src/agent";
import { describeClip, describeStyle } from "../src/prompt";

const narration = { ...sampleAnalysis, durationSec: 12, words: [
  { text: "The", start: 0.2, end: 0.45 }, { text: "button", start: 0.5, end: 0.8 },
  { text: "starts", start: 0.9, end: 1.2 }, { text: "it.", start: 1.3, end: 1.6 },
  { text: "See", start: 4.2, end: 4.5 }, { text: "the", start: 4.6, end: 4.8 }, { text: "result.", start: 4.9, end: 5.3 },
] };
const supporting: SupportingFootage[] = ["detail", "result"].map((id) => ({ name: id, description: `Supplied ${id} footage`, analysis: {
  ...sampleAnalysis, videoId: id, src: `/media/${id}/source.mp4`, hasSpeech: false, words: [], durationSec: 4,
  frames: [{ t: 0.2, url: `/media/${id}/frames/first.jpg` }, { t: 2.2, url: `/media/${id}/frames/second.jpg` }],
} }));
const shot = (overrides: Partial<NonNullable<AgentPlan["broll"]>[number]> = {}): NonNullable<AgentPlan["broll"]>[number] => ({
  assetId: "detail", srcStart: 0, srcEnd: 1, segmentIndex: 0, atSrcTime: 0.5,
  evidenceFrameTime: 0.2, purpose: "proof", reason: "Shows the button described in the narration.", ...overrides,
});
const brollPlan = (broll: NonNullable<AgentPlan["broll"]> = []): AgentPlan => ({
  ...sampleAgentPlans[1], segments: [{ srcStart: 0, srcEnd: 6, speed: 1 }], music: null, transitions: [], zooms: [], sfx: [], overlays: [], broll,
});

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
    assert.match(evidence[0].text!, /FRAMES: 2 images attached in time order at exact seconds 0, 16/);
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

test("two supporting assets cover pictures while primary speech and legacy plans remain intact", () => {
  const request = brollPlan([shot(), shot({ assetId: "result", atSrcTime: 4.2, purpose: "reaction", reason: "Shows the result named by the speaker.", fit: "contain" })]);
  const edit = compileEditPlan(request, narration, sampleLibrary, { id: "broll", supporting });
  assert.equal(edit.supporting?.length, 2);
  assert.deepEqual(edit.broll?.map((s) => [s.assetId, s.start, s.end]), [["detail", 0.5, 1.5], ["result", 4.2, 5.2]]);
  assert.equal(edit.broll?.[1].fit, "contain");
  const without = compileEditPlan({ ...request, broll: [] }, narration, sampleLibrary);
  assert.deepEqual(edit.clips, without.clips);
  assert.deepEqual(edit.captions, without.captions);
  assert.equal(checkEditQuality(edit, narration).passed, true);
  const { supporting: _assets, broll: _broll, quality: _quality, ...legacy } = without;
  assert.equal(EditPlan.safeParse(legacy).success, true);
});

test("supporting evidence labels preserve exact frame timestamps and source duration", () => {
  const description = describeClip({ ...supporting[0].analysis, durationSec: 2.786, frames: [{ t: 0.15, url: "/media/detail/frame.jpg" }] });
  assert.match(description, /CLIP: 2\.786s/);
  assert.match(description, /exact seconds 0\.15/);
});

test("floating point trim roundtrips survive while genuinely unavailable source time is rejected", () => {
  const full = brollPlan([shot({ srcEnd: 4 + Number.EPSILON * 8 })]);
  const ctx = { analysis: narration, library: sampleLibrary, supporting };
  const normalized = normalizePlan(full, ctx);
  assert.equal(normalized.broll?.[0].srcEnd, 4);
  assert.equal(compileEditPlan(full, narration, sampleLibrary, { id: "float", supporting }).broll?.length, 1);
  assert.deepEqual(compileEditPlan(brollPlan([shot({ srcEnd: 4.001 })]), narration, sampleLibrary, { id: "unavailable", supporting }).broll, []);
  const edit = compileEditPlan(brollPlan([shot()]), narration, sampleLibrary, { id: "source-gate", supporting });
  const invalid = { ...edit, broll: edit.broll!.map((s) => ({ ...s, srcEnd: 4.001, end: s.start + 4.001 })) };
  assert.equal(checkEditQuality(invalid, narration).passed, false);
  const fractional = [{ ...supporting[0], analysis: { ...supporting[0].analysis, durationSec: 4.0006 } }];
  const bounded = compileEditPlan(brollPlan([shot({ srcEnd: 4.0006 })]), narration, sampleLibrary, { id: "fractional", supporting: fractional });
  assert.ok(bounded.broll![0].srcEnd <= 4.0006);
  assert.equal(checkEditQuality(bounded, narration).passed, true);
});

test("supporting placement identifies the exact repeated occurrence and respects primary playback speed", () => {
  const request = { ...brollPlan([shot({ segmentIndex: 0, atSrcTime: 4.6 }), shot({ assetId: "result", segmentIndex: 2, atSrcTime: 4.6 })]), segments: [
    { srcStart: 4, srcEnd: 6, speed: 1 }, { srcStart: 0, srcEnd: 3, speed: 1 }, { srcStart: 4, srcEnd: 6, speed: 0.5 },
  ] };
  const edit = compileEditPlan(request, narration, sampleLibrary, { id: "repeat", supporting });
  assert.deepEqual(edit.broll?.map((s) => [s.clipId, s.start, s.end]), [["c0", 0.6, 1.6], ["c2", 6.2, 7.2]]);
  assert.equal(checkEditQuality(edit, narration).passed, true);
});

test("missing footage, invalid trims, invented evidence, removed anchors and overlaps cannot compile into B-roll", () => {
  const invalid = [
    shot({ assetId: "not-supplied" }), shot({ srcEnd: 10 }), shot({ srcStart: 2, srcEnd: 1 }), shot({ srcStart: -1 }), shot({ atSrcTime: Number.NaN }),
    shot({ evidenceFrameTime: 0.8 }), shot({ atSrcTime: 7 }), shot({ segmentIndex: 9 }),
  ];
  assert.deepEqual(compileEditPlan(brollPlan(invalid), narration, sampleLibrary, { id: "invalid", supporting }).broll, []);
  const normalized = normalizePlan(brollPlan(invalid), { analysis: narration, library: sampleLibrary, supporting });
  assert.equal(normalized.broll?.some((s) => s.assetId === "not-supplied"), false);
  assert.deepEqual(compileEditPlan(brollPlan([shot(), shot({ assetId: "result", atSrcTime: 0.8 })]), narration, sampleLibrary, { id: "overlap", supporting }).broll?.map((s) => s.assetId), ["detail"]);
});

test("invalid segment removal remaps supporting anchors and transitions without changing their source occurrence", () => {
  const request = { ...brollPlan([shot({ segmentIndex: 1 })]), segments: [
    { srcStart: 8, srcEnd: 8.1, speed: 1 }, { srcStart: 0, srcEnd: 2, speed: 1 }, { srcStart: 4, srcEnd: 6, speed: 1 },
  ], transitions: [{ afterSegment: 0, type: "flash" as const }, { afterSegment: 1, type: "whip" as const }] };
  const normalized = normalizePlan(request, { analysis: narration, library: sampleLibrary, supporting });
  assert.equal(normalized.broll?.[0].segmentIndex, 0);
  assert.deepEqual(normalized.transitions, [{ afterSegment: 0, type: "whip" }]);
  const direct = compileEditPlan(request, narration, sampleLibrary, { id: "direct", supporting });
  const repaired = compileEditPlan(normalized, narration, sampleLibrary, { id: "normalized", supporting });
  assert.deepEqual(direct.broll?.map((s) => [s.start, s.clipId]), [[0.5, "c0"]]);
  assert.equal(direct.broll?.[0].segmentIndex, 0);
  assert.equal(checkEditQuality(direct, narration).passed, true);
  assert.deepEqual(direct.transitions, repaired.transitions);
  assert.equal(direct.transitions[0].type, "whip");
});

test("beat changes use the final narration layout, and a supporting trim stops before its anchor segment ends", () => {
  const quiet = { ...narration, hasSpeech: false, words: [] };
  const lib = { ...sampleLibrary, music: [{ ...sampleLibrary.music[0], beats: [0, 2, 4, 6, 8], downbeats: [0], dropAt: null }] };
  const request = { ...brollPlan([shot({ segmentIndex: 1, atSrcTime: 4.5, srcEnd: 3 })]), segments: [
    { srcStart: 0, srcEnd: 2.2, speed: 1 }, { srcStart: 4, srcEnd: 6, speed: 1 },
  ], music: { trackId: lib.music[0].id, volume: 0.1, alignDropToSrc: null, snapCutsToBeats: true } };
  const edit = compileEditPlan(request, quiet, lib, { id: "beats", supporting });
  assert.deepEqual(edit.broll?.map((s) => [s.start, s.end, s.srcEnd]), [[2.5, 4, 1.5]]);
  assert.equal(checkEditQuality(edit, quiet).passed, true);
});

test("quality gates reject wrong-time captions using valid vocabulary and invalid cue interval ends", () => {
  const edit = compileEditPlan(brollPlan([shot()]), narration, sampleLibrary, { id: "checks", supporting });
  const wrongWords = { ...edit, captions: { ...edit.captions, chunks: [{ start: 0.2, end: 0.45, words: [{ text: "result.", start: 0.2, end: 0.45, emphasis: false }] }] } };
  assert.equal(checkEditQuality(wrongWords, narration).passed, false);
  assert.match(checkEditQuality(wrongWords, narration).errors.join(" "), /speech at that time/);
  const wrongEnds = { ...edit, overlays: [{ start: 5, end: 9, text: "Too late" }], zooms: [{ start: 5, end: 4, scale: 1.1, kind: "punch" as const }], transitions: [{ at: 5.9, type: "flash" as const, durationSec: 1 }] };
  assert.match(checkEditQuality(wrongEnds).errors.join(" "), /effect interval|transition interval/);
  const forged = { ...edit, broll: edit.broll!.map((s) => ({ ...s, assetId: "not-owned" })) };
  assert.equal(checkEditQuality(forged).passed, false);
});

test("judgmental editorial checks remain reviewable warnings and unavailable checks are disclosed", () => {
  const edit = compileEditPlan(brollPlan([shot()]), narration, sampleLibrary, { id: "review", supporting });
  const report = checkEditQuality({ ...edit, hookText: "The fastest result ever" }, narration);
  assert.equal(report.passed, true);
  assert.match(report.warnings.join(" "), /wording needs editorial review/);
  assert.match(report.warnings.join(" "), /do not establish semantic fit/);
  const withoutAnalysis = checkEditQuality(edit);
  assert.equal(withoutAnalysis.checks.includes("Speech boundaries"), false);
  assert.equal(withoutAnalysis.checks.includes("Caption/transcript alignment"), false);
  assert.match(withoutAnalysis.warnings.join(" "), /were not checked/);
  const limited = { ...narration, warnings: ["Some recognized speech had no valid word timing."] };
  assert.ok(checkEditQuality(edit, limited).warnings.includes(limited.warnings[0]));
  assert.match(describeClip(limited), /ANALYSIS LIMITS/);
});

test("a planner can leave supplied but unhelpful cutaways unused and receives the research rubric", async () => {
  const previous = globalThis.fetch;
  let body: any;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    const chunk = { choices: [{ delta: { content: JSON.stringify(brollPlan([])) } }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  try {
    const results = [];
    for await (const r of generateVariants({ analysis: narration, library: sampleLibrary, supporting, loadFrame: async (url) => `data:image/jpeg;base64,${url}`, config: { url: "https://agent-test.invalid", token: "test", agentId: "test" } }, "Keep the speaker visible; these details are unrelated", { count: 1 })) results.push(r);
    assert.equal(results[0].error, undefined);
    assert.deepEqual(results[0].result?.editPlan.broll, []);
    assert.equal(results[0].result?.editPlan.quality?.passed, true);
    assert.match(body.messages[0].content, /Research-derived editing decisions/);
    assert.match(JSON.stringify(body.messages[1].content), /SUPPORTING FOOTAGE assetId=detail/);
    assert.match(body.messages[0].content, /Empty broll is a valid choice/);
  } finally { globalThis.fetch = previous; }
});

test("remix receives authoritative manual caption and cutaway state while legacy calls remain valid", async () => {
  const previous = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const chunk = { choices: [{ delta: { content: JSON.stringify(brollPlan([])) } }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  try {
    const current = brollPlan([shot()]);
    const compiled = compileEditPlan(current, narration, sampleLibrary, { id: "manual-preview", supporting });
    const manual: EditPlan = { ...compiled, broll: [], music: null, captions: { ...compiled.captions, enabled: false, preset: "story", design: { typeface: "serif", fontScale: 0.8, weight: "regular", textColor: "#EEEEEE", highlightMode: "none", animation: "none", outline: false } } };
    const ctx = { analysis: narration, library: sampleLibrary, supporting, loadFrame: async (url: string) => `data:image/jpeg;base64,${url}`, config: { url: "https://agent-test.invalid", token: "test", agentId: "test" } };
    await remixPlan(ctx, current, "Keep this design; shorten the opening", { currentEdit: manual });
    const prompt = requests[0].messages.at(-1).content;
    assert.match(prompt, /AUTHORITATIVE CURRENT EDIT/);
    assert.ok(prompt.includes(JSON.stringify(manual)));
    assert.match(prompt, /Do not restore disabled or removed layers/);
    assert.equal(JSON.parse(requests[0].messages[2].content).broll.length, 1);
    await remixPlan(ctx, current, "Leave the story intact");
    assert.doesNotMatch(requests[1].messages.at(-1).content, /AUTHORITATIVE CURRENT EDIT/);
    assert.match(requests[1].messages.at(-1).content, /the plan above/);
  } finally { globalThis.fetch = previous; }
});
