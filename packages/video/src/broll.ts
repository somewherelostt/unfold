import type { EditPlan } from "@unfold/core";

export function resolveBrollPlacements(plan: EditPlan) {
  if (!plan.broll?.length) return [];
  if (!(plan.fps > 0) || !Number.isFinite(plan.fps)) throw new Error("B-roll needs a valid timeline frame rate.");
  const total = Math.round(plan.durationSec * plan.fps);
  const ids = new Set<string>();
  const placements = plan.broll.map((shot) => {
    const asset = plan.supporting?.find((item) => item.videoId === shot.assetId);
    if (!asset) throw new Error(`B-roll ${shot.id} references unavailable supporting footage.`);
    if (plan.supporting!.filter((item) => item.videoId === shot.assetId).length !== 1) throw new Error(`B-roll ${shot.id} has an ambiguous supporting asset reference.`);
    if (ids.has(shot.id)) throw new Error(`B-roll ${shot.id} repeats a placement identifier.`);
    ids.add(shot.id);
    if (!asset.src || ![asset.width, asset.height].every((n) => Number.isFinite(n) && n > 0)) throw new Error(`B-roll ${shot.id} has invalid supporting media metadata.`);
    if (![shot.start, shot.end, shot.srcStart, shot.srcEnd, asset.durationSec].every(Number.isFinite)
      || shot.start < 0 || shot.end > plan.durationSec + 0.001 || shot.srcStart < 0 || shot.srcEnd > asset.durationSec + 0.001
      || shot.srcEnd <= shot.srcStart || shot.end <= shot.start
      || Math.abs(shot.end - shot.start - (shot.srcEnd - shot.srcStart)) > 1 / plan.fps + 0.001) {
      throw new Error(`B-roll ${shot.id} has an invalid source or output range.`);
    }
    const from = Math.round(shot.start * plan.fps);
    const to = Math.round(shot.end * plan.fps);
    if (from < 0 || to > total || to <= from) throw new Error(`B-roll ${shot.id} has no valid output frames.`);
    const fit = shot.fit ?? "cover";
    if (fit !== "cover" && fit !== "contain") throw new Error(`B-roll ${shot.id} has an unsupported aspect fit.`);
    return { shot, asset, from, to, durationInFrames: to - from, trimBefore: Math.round(shot.srcStart * plan.fps), fit };
  }).sort((a, b) => a.from - b.from);
  for (let i = 1; i < placements.length; i++) {
    if (placements[i].from < placements[i - 1].to) throw new Error("Supporting visual placements overlap.");
  }
  return placements;
}
