import type { EditPlan, MediaAnalysis, QualityReport } from "./schema";

/** Technical gates complement the planner's story review; they do not score creative taste. */
export function checkEditQuality(plan: EditPlan, analysis?: MediaAnalysis): QualityReport {
  const errors: string[] = [];
  const warnings: string[] = [...(analysis?.warnings ?? [])];
  const checks = ["Continuous timeline", "Caption timing", "B-roll assets and anchors", "Cue timing"];
  if (analysis) checks.push("Source ranges");
  if (analysis?.hasSpeech) checks.push("Speech boundaries", "Caption/transcript alignment");
  if (!analysis) warnings.push("Primary analysis was not supplied; speech boundaries and caption/transcript alignment were not checked.");
  const finite = (n: number) => Number.isFinite(n);
  const within = (s: number, e: number, duration: number) => finite(s) && finite(e) && s >= 0 && e > s && e <= duration + 0.04;
  if (!finite(plan.durationSec) || plan.durationSec <= 0 || !plan.clips.length) errors.push("The edit needs a non-empty video timeline.");
  let end = 0;
  for (const clip of plan.clips) {
    if (!within(clip.start, clip.end, plan.durationSec) || Math.abs(clip.start - end) > 0.04) errors.push(`Clip ${clip.id} leaves a gap or overlaps the timeline.`);
    if (!finite(clip.srcStart) || !finite(clip.srcEnd) || !(clip.speed >= 0.5 && clip.speed <= 2) || clip.srcStart < 0 || clip.srcEnd <= clip.srcStart || (analysis && clip.srcEnd > analysis.durationSec + 0.04)) errors.push(`Clip ${clip.id} has an invalid source range.`);
    if (Math.abs((clip.srcEnd - clip.srcStart) / clip.speed - (clip.end - clip.start)) > 0.04) errors.push(`Clip ${clip.id} timing does not match its source range.`);
    if (analysis?.hasSpeech) {
      for (const boundary of [clip.srcStart, clip.srcEnd]) {
        if (analysis.words.some((w) => w.end <= analysis.durationSec && w.start + 0.025 < boundary && w.end - 0.025 > boundary)) errors.push(`Clip ${clip.id} cuts through a spoken word.`);
      }
      const last = analysis.words.filter((w) => w.end <= clip.srcEnd + 0.025 && w.end > clip.srcStart).at(-1);
      const next = analysis.words.find((w) => w.start >= clip.srcEnd - 0.025 && w.start > (last?.start ?? -1));
      if (last && next && !/[.!?।]["'’”)]?$/.test(last.text) && next.start - last.end < 0.4) warnings.push(`Clip ${clip.id} may end before a spoken thought finishes; review the retained message.`);
    }
    end = clip.end;
  }
  if (Math.abs(end - plan.durationSec) > 0.04) errors.push("The timeline does not reach the edit's declared end.");
  for (const chunk of plan.captions.chunks) {
    if (!within(chunk.start, chunk.end, plan.durationSec)) errors.push("A caption falls outside the video timeline.");
    for (const word of chunk.words) {
      if (!within(word.start, word.end, plan.durationSec) || word.start < chunk.start - 0.04 || word.end > chunk.end + 0.04) errors.push("A caption word has invalid timing.");
      if (analysis && !plan.clips.some((clip) => analysis.words.some((w) => {
        const mid = (w.start + w.end) / 2;
        const start = clip.start + (Math.max(w.start, clip.srcStart) - clip.srcStart) / clip.speed;
        const end = clip.start + (Math.min(w.end, clip.srcEnd) - clip.srcStart) / clip.speed;
        return mid >= clip.srcStart && mid < clip.srcEnd && w.text.trim() === word.text.trim() && Math.abs(start - word.start) < 0.05 && Math.abs(end - word.end) < 0.05;
      }))) errors.push("A caption does not match the supplied speech at that time.");
    }
  }
  const broll = [...(plan.broll ?? [])].sort((a, b) => a.start - b.start);
  for (const [i, shot] of broll.entries()) {
    const asset = plan.supporting?.find((a) => a.videoId === shot.assetId);
    const anchor = plan.clips.find((c) => c.id === shot.clipId);
    if (!asset) { errors.push(`B-roll ${shot.id} references unavailable footage.`); continue; }
    if (!within(shot.srcStart, shot.srcEnd, asset.durationSec) || !within(shot.start, shot.end, plan.durationSec)) errors.push(`B-roll ${shot.id} exceeds its available footage.`);
    if (Math.abs(shot.srcEnd - shot.srcStart - (shot.end - shot.start)) > 0.04) errors.push(`B-roll ${shot.id} would stretch or freeze its source.`);
    if (!anchor || shot.atSrcTime < anchor.srcStart || shot.atSrcTime >= anchor.srcEnd || Math.abs(shot.start - anchor.start - (shot.atSrcTime - anchor.srcStart) / anchor.speed) > 0.04 || shot.end > anchor.end + 0.04) errors.push(`B-roll ${shot.id} lost its narration anchor.`);
    if (!asset.frames.some((f) => Math.abs(f.t - shot.evidenceFrameTime) < 0.02) || shot.evidenceFrameTime < shot.srcStart || shot.evidenceFrameTime >= shot.srcEnd) errors.push(`B-roll ${shot.id} is missing its sampled-frame evidence.`);
    if (!shot.reason.trim() || !shot.purpose) errors.push(`B-roll ${shot.id} needs a narrative purpose.`);
    if (i && broll[i - 1].end > shot.start + 0.02) errors.push("Supporting shots overlap one another.");
  }
  for (const cue of [...plan.sfx.map((s) => s.at), ...plan.transitions.map((t) => t.at), ...plan.zooms.map((z) => z.start), ...plan.overlays.map((o) => o.start)]) {
    if (!finite(cue) || cue < 0 || cue >= plan.durationSec) errors.push("An effect is placed outside the edit.");
  }
  for (const cue of [...plan.zooms, ...plan.overlays]) if (!within(cue.start, cue.end, plan.durationSec)) errors.push("An effect interval exceeds the edit or has no duration.");
  for (const cue of plan.transitions) if (!finite(cue.durationSec) || cue.durationSec < 0 || cue.at + cue.durationSec > plan.durationSec + 0.04) errors.push("A transition interval exceeds the edit.");
  for (const volume of [...plan.sfx.map((s) => s.volume), ...(plan.music ? [plan.music.volume] : [])]) if (!finite(volume) || volume < 0 || volume > 1) errors.push("An audio gain is outside the supported range.");
  if (plan.music && analysis?.hasSpeech && plan.music.volume > 0.25) warnings.push("Music is relatively loud under dialogue; listen to the export.");
  if (plan.captions.enabled && analysis?.hasSpeech && !plan.captions.chunks.length) warnings.push("Captions are enabled but no spoken words survived the edit.");
  if (plan.captions.enabled && plan.captions.chunks.some((chunk) => chunk.words.length > 1 && chunk.end - chunk.start < chunk.words.length * 0.12)) warnings.push("Some captions appear very briefly; review readability at playback speed.");
  if (plan.hookText || plan.overlays.some((o) => o.text.trim())) warnings.push("Hook and overlay wording needs editorial review against the supplied footage; timing checks do not verify its claims.");
  if (broll.length) warnings.push("Supporting-shot relevance is a planner/creator judgment; asset and timing checks do not establish semantic fit.");
  return { passed: errors.length === 0, checks, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
