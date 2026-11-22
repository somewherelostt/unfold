import assert from "node:assert/strict";
import test from "node:test";
import { compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary, type EditPlan } from "@unfold/core";
import { captionChunkIndexAt, orderCaptionChunks } from "../src/captionTiming";

test("cold-open captions follow output order and retain speed-adjusted timings", () => {
  const plan = compileEditPlan(
    {
      ...sampleAgentPlans[0],
      segments: [
        { srcStart: 4, srcEnd: 5, speed: 1 },
        { srcStart: 0, srcEnd: 1, speed: 2 },
      ],
      music: null,
      captions: { ...sampleAgentPlans[0].captions, wordsPerChunk: 2 },
    },
    {
      ...sampleAnalysis,
      words: [
        { text: "first", start: 0.2, end: 0.4 },
        { text: "part", start: 0.6, end: 0.8 },
        { text: "cold", start: 4.2, end: 4.4 },
        { text: "open", start: 4.6, end: 4.8 },
      ],
    },
    sampleLibrary,
  );

  assert.deepEqual(
    plan.captions.chunks.map(({ start, end, words }) => ({ start, end, words: words.map((w) => [w.text, w.start, w.end]) })),
    [
      { start: 0.2, end: 0.8, words: [["cold", 0.2, 0.4], ["open", 0.6, 0.8]] },
      { start: 1.1, end: 1.4, words: [["first", 1.1, 1.2], ["part", 1.3, 1.4]] },
    ],
  );
});

test("every sample cold-open chunk can be selected at its spoken time", () => {
  const plan = compileEditPlan(sampleAgentPlans[0], sampleAnalysis, sampleLibrary);
  const chunks = plan.captions.chunks;
  assert.deepEqual(chunks.map((c) => c.start), [...chunks].map((c) => c.start).sort((a, b) => a - b));
  for (const chunk of chunks) {
    const selected = captionChunkIndexAt(chunks, (chunk.start + chunk.end) / 2);
    assert.equal(chunks[selected], chunk, chunk.words.map((w) => w.text).join(" "));
  }
});

test("legacy reordered chunks remain visible without mutating the stored plan", () => {
  const chunk = (text: string, start: number, end: number): EditPlan["captions"]["chunks"][number] => ({
    start,
    end,
    words: [{ text, start, end, emphasis: false }],
  });
  const legacy = [chunk("just", 11.33, 11.658), chunk("cold", 0.2, 0.98), chunk("open", 1.04, 1.82)];
  const original = structuredClone(legacy);
  const chunks = orderCaptionChunks(legacy);

  assert.equal(chunks[captionChunkIndexAt(chunks, 11.4)].words[0].text, "just");
  assert.equal(chunks[captionChunkIndexAt(chunks, 0.5)].words[0].text, "cold");
  assert.equal(chunks[captionChunkIndexAt(chunks, 1.1)].words[0].text, "open");
  assert.equal(captionChunkIndexAt(chunks, 3), -1);
  assert.deepEqual(legacy, original);
});
