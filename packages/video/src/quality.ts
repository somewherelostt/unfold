import { checkEditQuality, type EditPlan, type MediaAnalysis, type QualityReport } from "@unfold/core";
import { resolveBrollPlacements } from "./broll";
import { hookRepeatsOpening, resolveCaptionDesign } from "./captionDesign";
import { unit } from "./typography";

export type ReviewInterval = { start: number; end: number };
export type ReviewFrame = { frame: number; time: number; label: string; file: string };
export type RenderedQualityReview = QualityReport & {
  version: 1;
  planId: string;
  planFingerprint: string;
  coverage: Record<string, string>;
  metrics: {
    durationSec: number;
    width: number;
    height: number;
    fps: number;
    blackIntervals: ReviewInterval[];
    frozenIntervals: ReviewInterval[];
    audio?: { sampleRate: number; channels: number; seconds: number; rmsDbfs: number | null; peakDbfs: number | null; integratedLufs: number | null; fullScaleSamples: number; samples: number; silenceIntervals: ReviewInterval[] };
    narration?: { time: number; label: string; correlation: number | null; lagMs: number | null; referenceRmsDbfs: number | null; outputRmsDbfs: number | null }[];
  };
  artifacts: { report: string; contactSheet: string; frames: ReviewFrame[] };
};

export function checkPlanQuality(plan: EditPlan, analysis?: MediaAnalysis): QualityReport {
  const base = checkEditQuality(plan, analysis);
  const errors = [...base.errors];
  const warnings = [...base.warnings];
  const checks = [...base.checks, "Supporting visual frame ranges", "Computed caption type size", "Opening title duplication"];
  if (![plan.width, plan.height, plan.fps].every((n) => Number.isFinite(n) && n > 0)
    || !Number.isInteger(plan.width) || !Number.isInteger(plan.height)) errors.push("Output dimensions and frame rate must be valid positive values.");
  try { resolveBrollPlacements(plan); } catch (error) { errors.push(error instanceof Error ? error.message : "Invalid supporting visual placement."); }
  if (plan.captions.enabled) {
    const look = resolveCaptionDesign(plan.captions);
    for (const [i, chunk] of plan.captions.chunks.entries()) {
      const longest = Math.max(1, ...chunk.words.map((word) => word.text.length));
      const pixels = Math.min(look.size * unit(plan), plan.width * 0.74 / (longest * 0.61));
      if (pixels < 18) warnings.push(`Caption ${i + 1} computes to ${pixels.toFixed(1)} pixels; inspect its readability at the export size.`);
    }
  }
  if (hookRepeatsOpening(plan)) warnings.push("The opening title repeats the captioned opening and will be suppressed by the renderer.");
  return { passed: errors.length === 0, checks, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}

/** Compare only the trusted effective plan; never persist a temporary capability-bearing plan. */
export async function fingerprintPlan(plan: EditPlan): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(plan)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/** This exact duplicate is already hidden on screen; other editorial changes need an editor. */
export function reviseDeterministicFaults(plan: EditPlan): { plan: EditPlan; changes: string[] } {
  if (!hookRepeatsOpening(plan)) return { plan, changes: [] };
  return { plan: { ...plan, hookText: null }, changes: ["Removed the duplicate opening title that the renderer suppresses."] };
}

/** One bounded inspection/revision pass; invalid assets or speech edits are never silently repaired. */
export function inspectAndRevisePlan(plan: EditPlan, analysis?: MediaAnalysis) {
  const before = checkPlanQuality(plan, analysis);
  const revised = reviseDeterministicFaults(plan);
  return { ...revised, before, after: revised.changes.length ? checkPlanQuality(revised.plan, analysis) : before };
}

export function reviewFrameSamples(plan: EditPlan, maxFrames = 18): Omit<ReviewFrame, "file">[] {
  const total = Math.max(1, Math.round(plan.durationSec * plan.fps));
  const samples = new Map<number, string>();
  const add = (time: number, label: string) => {
    if (!Number.isFinite(time)) return;
    const frame = Math.max(0, Math.min(total - 1, Math.round(time * plan.fps)));
    if (!samples.has(frame) && samples.size < maxFrames) samples.set(frame, label);
  };
  const shots = plan.broll ?? [];
  const seenAssets = new Set<string>();
  const unique = shots.filter((shot) => { if (seenAssets.has(shot.assetId)) return false; seenAssets.add(shot.assetId); return true; });
  const prioritized = [...unique, ...shots.filter((shot) => !unique.includes(shot))].slice(0, Math.max(1, Math.floor((maxFrames - 5) / 3)));
  for (const shot of prioritized) {
    if (shot.start > 0) add(shot.start - 1 / plan.fps, `Before ${shot.id}`);
    add((shot.start + shot.end) / 2, `During ${shot.id}`);
    if (shot.end < plan.durationSec) add(shot.end + 1 / plan.fps, `After ${shot.id}`);
  }
  if (plan.captions.enabled) {
    const chunks = [...plan.captions.chunks].sort((a, b) => b.words.map((w) => w.text).join(" ").length - a.words.map((w) => w.text).join(" ").length);
    for (const chunk of chunks.slice(0, 3)) add((chunk.start + chunk.end) / 2, "Caption placement");
  }
  add(Math.min(0.7, plan.durationSec / 2), "Opening");
  add(plan.durationSec - 0.1, "Ending");
  for (const clip of plan.clips.slice(1)) {
    add(clip.start - 1 / plan.fps, `Before cut ${clip.id}`);
    add(clip.start + 1 / plan.fps, `After cut ${clip.id}`);
  }
  return [...samples].sort(([a], [b]) => a - b).map(([frame, label]) => ({ frame, time: frame / plan.fps, label }));
}
