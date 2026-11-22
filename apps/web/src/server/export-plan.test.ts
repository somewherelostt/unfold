import assert from "node:assert/strict";
import { test } from "node:test";
import { compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary } from "@unfold/core";
import { ExportRequest, prepareExportPlan } from "./export-plan";

const saved = compileEditPlan(sampleAgentPlans[0], sampleAnalysis, sampleLibrary, { id: "export-check" });

test("exports the manual preview at the requested resolution without mutating it", () => {
  const edited = { ...saved, hookText: "My new hook", aspect: "16:9" as const, music: null, sfx: [] };
  const result = prepareExportPlan(saved, ExportRequest.parse({ planId: saved.id, editPlan: edited, resolution: "720p", burnCaptions: false }), sampleLibrary);
  assert.equal(result.hookText, "My new hook");
  assert.equal(result.music, null);
  assert.deepEqual(result.sfx, []);
  assert.deepEqual([result.width, result.height], [1280, 720]);
  assert.equal(result.captions.enabled, false);
  assert.equal(edited.captions.enabled, saved.captions.enabled);
  assert.deepEqual(result.captions.chunks, edited.captions.chunks);
});

test("legacy requests retain the saved plan and default to full resolution", () => {
  const result = prepareExportPlan(saved, ExportRequest.parse({ planId: saved.id }), sampleLibrary);
  assert.equal(result.hookText, saved.hookText);
  assert.deepEqual([result.width, result.height], [1080, 1920]);
});

test("validates settings and rejects changed source media", () => {
  assert.equal(ExportRequest.safeParse({ planId: "../escape" }).success, false);
  assert.equal(ExportRequest.safeParse({ planId: saved.id, resolution: "4k" }).success, false);
  const edited = { ...saved, source: { ...saved.source, src: "https://invalid.example/video.mp4" } };
  assert.throws(() => prepareExportPlan(saved, ExportRequest.parse({ planId: saved.id, editPlan: edited }), sampleLibrary), /saved clip/);
});

test("uses trusted asset URLs for manual music and sound choices", () => {
  const edited = { ...saved, music: saved.music ? { ...saved.music, url: "https://invalid.example/audio" } : null };
  const result = prepareExportPlan(saved, ExportRequest.parse({ planId: saved.id, editPlan: edited }), sampleLibrary);
  if (result.music) assert.equal(result.music.url, sampleLibrary.music.find((track) => track.id === result.music!.trackId)!.url);
});
