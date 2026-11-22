import type { EditPlan } from "@unfold/core";
import type { BrollShot, SupportingAsset } from "./types";

/** Preserve the source-to-narration anchor when the creator moves or replaces a cutaway. */
export function reviseBroll(plan: EditPlan, shot: BrollShot, patch: Partial<BrollShot>): BrollShot {
  const next = { ...shot, ...patch };
  const asset = plan.supporting?.find((a) => a.videoId === next.assetId);
  if (!asset) throw new Error("Choose footage attached to this edit.");
  const anchor = plan.clips.find((c) => next.start >= c.start && next.start < c.end);
  if (!anchor) throw new Error("Place the cutaway inside the edit.");
  const duration = next.end - next.start;
  if (![next.start, next.end, next.srcStart].every(Number.isFinite) || duration < 0.3) throw new Error("Use a cutaway at least 0.3 seconds long.");
  if (next.end > anchor.end + 0.001) throw new Error(`End this cutaway by ${anchor.end.toFixed(2)}s, before the narration cut.`);
  next.srcEnd = next.srcStart + duration;
  if (next.srcStart < 0 || next.srcEnd > asset.durationSec + 0.001) throw new Error("The selected range exceeds the supporting footage. Shorten it or move its source start.");
  if ((plan.broll ?? []).some((b) => b.id !== shot.id && b.start < next.end && b.end > next.start)) throw new Error("Cutaways cannot overlap. Move or shorten this one.");
  const frames = asset.frames.filter((f) => f.t >= next.srcStart && f.t < next.srcEnd);
  const frame = frames.find((f) => f.t === shot.evidenceFrameTime) ?? frames[0];
  if (!frame) throw new Error("Include one of this asset’s sampled frames in the selected source range.");
  next.evidenceFrameTime = frame.t;
  next.clipId = anchor.id;
  next.segmentIndex = anchor.id === shot.clipId ? shot.segmentIndex : plan.clips.indexOf(anchor);
  next.atSrcTime = anchor.srcStart + (next.start - anchor.start) * anchor.speed;
  return next;
}

export function newBroll(plan: EditPlan, asset: SupportingAsset, at: number): BrollShot {
  const start = Math.max(0, at);
  const anchor = plan.clips.find((c) => start >= c.start && start < c.end);
  if (!anchor) throw new Error("Seek inside a narration clip before adding a cutaway.");
  const srcStart = asset.frames[0]?.t ?? 0;
  const duration = Math.min(2.5, anchor.end - start, asset.durationSec - srcStart);
  const shot: BrollShot = {
    id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    assetId: asset.videoId, start, end: start + duration, srcStart, srcEnd: srcStart + duration,
    atSrcTime: anchor.srcStart + (start - anchor.start) * anchor.speed, clipId: anchor.id,
    segmentIndex: plan.clips.indexOf(anchor), fit: "cover",
    evidenceFrameTime: srcStart, purpose: "context", reason: "Creator placed this supporting shot alongside the narration.",
  };
  return reviseBroll(plan, shot, {});
}

export function mergeSupporting(...groups: (SupportingAsset[] | undefined)[]): SupportingAsset[] {
  return [...new Map(groups.flatMap((g) => g ?? []).map((a) => [a.videoId, a])).values()];
}
