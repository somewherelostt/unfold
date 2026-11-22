import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary } from "@unfold/core";
import { checkPlanQuality, fingerprintPlan, reviseDeterministicFaults, inspectAndRevisePlan, reviewFrameSamples } from "../src/quality";
import { parseInspectionIntervals, reviewRenderedPlan } from "../src/review";

const base = compileEditPlan({ ...sampleAgentPlans[1], music: null }, sampleAnalysis, sampleLibrary);
test("canonical review fingerprints ignore key insertion order but detect a changed effective plan", async () => {
  assert.equal(await fingerprintPlan(base), await fingerprintPlan(Object.fromEntries(Object.entries(base).reverse()) as typeof base));
  assert.notEqual(await fingerprintPlan(base), await fingerprintPlan({ ...base, width: 720, height: 1280 }));
});
test("the server review entry imports under the actual server condition and preserves the full-plan fingerprint", async () => {
  const videoRoot = fileURLToPath(new URL("../", import.meta.url));
  const result = execFileSync(process.execPath, [
    "--conditions=react-server", "--import", path.join(videoRoot, "node_modules/tsx/dist/loader.mjs"), "--input-type=module", "-e",
    'import { readFileSync } from "node:fs"; import { fingerprintPlan, reviewRenderedPlan } from "@unfold/video/review"; const plan = JSON.parse(readFileSync(0, "utf8")); console.log(JSON.stringify({ fingerprint: await fingerprintPlan(plan), review: typeof reviewRenderedPlan }));',
  ], { cwd: path.resolve(videoRoot, "../../apps/web"), input: JSON.stringify(base), encoding: "utf8" });
  assert.deepEqual(JSON.parse(result), { fingerprint: await fingerprintPlan(base), review: "function" });
});
test("plan checks distinguish invalid references from a computed readability warning", () => {
  const tiny = { ...base, captions: { ...base.captions, chunks: [{ start: 0, end: 1, words: [{ text: "x".repeat(200), start: 0, end: 1, emphasis: false }] }] } };
  assert.ok(checkPlanQuality(tiny).warnings.some((warning) => warning.includes("pixels")));
  assert.ok(checkPlanQuality({ ...base, width: 0 }).errors.some((error) => error.includes("dimensions")));
});
test("the bounded revise step only removes an already suppressed duplicate hook", () => {
  const repeated = { ...base, hookText: "Same opening", captions: { ...base.captions, chunks: [{ start: 0, end: 1, words: [{ text: "Same", start: 0, end: 0.4, emphasis: false }, { text: "opening.", start: 0.4, end: 1, emphasis: false }] }] } };
  const result = reviseDeterministicFaults(repeated);
  assert.equal(result.plan.hookText, null); assert.equal(repeated.hookText, "Same opening");
  assert.equal(result.plan.clips, repeated.clips); assert.equal(result.changes.length, 1);
  assert.equal(reviseDeterministicFaults({ ...base, hookText: null }).changes.length, 0);
  const inspected = inspectAndRevisePlan(repeated);
  assert.ok(inspected.before.warnings.some((warning) => warning.includes("opening title")));
  assert.ok(!inspected.after.warnings.some((warning) => warning.includes("opening title")));
  assert.equal(inspectAndRevisePlan({ ...repeated, width: 0 }).after.passed, false);
});
test("composition review samples are bounded and include before/during/after each cutaway", () => {
  const shot = { id: "b0", start: 2, end: 4 };
  const samples = reviewFrameSamples({ ...base, broll: [shot] as typeof base.broll });
  assert.ok(samples.some((s) => s.label === "Before b0" && s.time < 2));
  assert.ok(samples.some((s) => s.label === "During b0" && s.time > 2 && s.time < 4));
  assert.ok(samples.some((s) => s.label === "After b0" && s.time > 4));
  assert.ok(samples.length <= 18);
});
test("measured dark/frozen/silent intervals close cleanly at end of inspected coverage", () => {
  assert.deepEqual(parseInspectionIntervals("black_start:1 black_end:2 black_start:3", "black", 4), [{ start: 1, end: 2 }, { start: 3, end: 4 }]);
  assert.deepEqual(parseInspectionIntervals("silence_start: -0.001 silence_end: 0.5", "silence", 2), [{ start: 0, end: 0.5 }]);
});

test("synthetic detector calibration measures actual black/frozen/silent media and writes private-safe evidence", { timeout: 30000 }, async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "unfold-review-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "fixture.mp4");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=96x96:r=10:d=1.2", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1.2", "-c:v", "libx264", "-c:a", "aac", output]);
  const plan = { ...base, id: "detector-calibration", width: 96, height: 96, fps: 10, durationSec: 1.2,
    source: { videoId: "fixture", src: "/media/private/fixture.mp4?cap=test-only-secret", width: 96, height: 96 },
    clips: [{ id: "c0", start: 0, end: 1.2, srcStart: 0, srcEnd: 1.2, speed: 1 }],
    captions: { ...base.captions, enabled: false, chunks: [] }, hookText: null, music: null, sfx: [], zooms: [], transitions: [], overlays: [], supporting: [], broll: [],
  };
  const directory = path.join(root, "review");
  const report = await reviewRenderedPlan(plan, { outputPath: output, reviewDir: directory, publicDir: root, resolveAsset: () => output });
  assert.equal(report.passed, true);
  assert.ok(report.metrics.blackIntervals.length > 0);
  assert.ok(report.metrics.frozenIntervals.length > 0);
  assert.ok(report.metrics.audio!.silenceIntervals.length > 0);
  assert.equal(report.metrics.audio!.rmsDbfs, null);
  assert.ok(existsSync(path.join(directory, report.artifacts.contactSheet)));
  assert.ok(report.artifacts.frames.length > 0 && report.artifacts.frames.length <= 18);
  const serialized = readFileSync(path.join(directory, "review.json"), "utf8");
  assert.ok(!serialized.includes("test-only-secret") && !serialized.includes(root));
  assert.equal(report.planFingerprint, await fingerprintPlan(plan));

  const loud = path.join(root, "loud.mp4");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", output, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1.2", "-map", "0:v:0", "-map", "1:a:0", "-af", "volume=12", "-c:v", "copy", "-c:a", "aac", "-t", "1.2", loud]);
  const clipped = await reviewRenderedPlan(plan, { outputPath: loud, reviewDir: path.join(root, "loud-review"), publicDir: root, resolveAsset: () => loud });
  assert.ok(clipped.metrics.audio!.fullScaleSamples > 0);
  assert.ok(clipped.warnings.some((warning) => warning.includes("full scale")));
  assert.equal(typeof clipped.metrics.audio!.integratedLufs, "number");
  const withSwitch = { ...plan, supporting: [{ videoId: "support", name: "Calibration", description: "Synthetic detector calibration", src: "/support.mp4", width: 96, height: 96, durationSec: 1.2, frames: [{ t: 0, url: "/frame.jpg" }] }],
    broll: [{ id: "b0", assetId: "support", srcStart: 0, srcEnd: 0.5, segmentIndex: 0, atSrcTime: 0.2, evidenceFrameTime: 0, purpose: "context" as const, reason: "Synthetic detector calibration only.", clipId: "c0", start: 0.2, end: 0.7 }] };
  const lost = await reviewRenderedPlan(withSwitch, { outputPath: output, reviewDir: path.join(root, "lost-audio-review"), publicDir: root, resolveAsset: () => loud });
  assert.equal(lost.passed, false);
  assert.ok(lost.errors.some((error) => error.includes("primary source audio disappeared")));
});

test("a pre-aborted review does not start inspection", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reviewRenderedPlan(base, { outputPath: "/private/tmp/unused.mp4", reviewDir: "/private/tmp/unused-review", publicDir: "/private/tmp", signal: controller.signal }), { name: "AbortError" });
});
