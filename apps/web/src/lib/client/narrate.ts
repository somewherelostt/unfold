/** Past-tense agent steps derived from an edit plan (generating chat + the editor's first message). */
import type { EditPlan } from "@unfold/core";

export const fmtClock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s - m * 60)).padStart(2, "0")}`;
};

/** One step per timeline track, in the order the tracks fill: video, captions, music, sfx, transitions. */
export function planSteps(plan: EditPlan): string[] {
  const hookAt = plan.clips[0]?.srcStart ?? 0;
  return [
    plan.hookText ? `Found the hook at ${fmtClock(hookAt)}: “${plan.hookText}”` : `Used ${plan.clips.length} clip${plan.clips.length === 1 ? "" : "s"} for ${plan.durationSec.toFixed(1)}s`,
    plan.captions.enabled ? `Wrote ${plan.captions.chunks.length} caption lines in the ${plan.captions.preset.replace("-", " ")} style` : "Left captions off",
    plan.music ? `Picked “${plan.music.title}” at ${Math.round(plan.music.bpm)} BPM` : "Kept your audio, no music",
    plan.sfx.length ? `Placed ${plan.sfx.length} sound effect${plan.sfx.length === 1 ? "" : "s"}` : "Skipped sound effects",
    plan.transitions.length || plan.zooms.length
      ? `Added ${plan.transitions.length} transition${plan.transitions.length === 1 ? "" : "s"} and ${plan.zooms.length} zoom${plan.zooms.length === 1 ? "" : "s"}`
      : plan.clips.length > 1 ? "Kept straight cuts" : "Kept the continuous shot",
  ];
}

/** One-sentence summary with the numbers that matter. */
export function planSummary(plan: EditPlan): string {
  return `${plan.durationSec.toFixed(1)}s edit, ${plan.clips.length} clip${plan.clips.length === 1 ? "" : "s"}${plan.music ? ` with ${Math.round(plan.music.bpm)} BPM music` : ""}, ${plan.sfx.length} sound effect${plan.sfx.length === 1 ? "" : "s"}. ${plan.rationale}`;
}
