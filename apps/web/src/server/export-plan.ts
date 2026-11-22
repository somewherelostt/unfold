import { ASPECT_SIZE, EditPlan, checkEditQuality, type Library, type MediaAnalysis, type SupportingFootage } from "@unfold/core";
import { z } from "zod";

export const ExportRequest = z.object({
  planId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  editPlan: EditPlan.optional(),
  resolution: z.enum(["720p", "1080p"]).default("1080p"),
  burnCaptions: z.boolean().default(true),
});

export type TrustedPlanAssets = { analysis: MediaAnalysis; supporting: SupportingFootage[] };
export type ExportSettings = { resolution: "720p" | "1080p"; burnCaptions: boolean };
export type ExportFingerprints = { submittedInputFingerprint: string; renderedPlanFingerprint: string; settings: ExportSettings };

/** Validate the current edit without applying export-only resolution or caption settings. */
export function prepareEffectivePlan(saved: EditPlan, plan: EditPlan, library: Library, trusted?: TrustedPlanAssets): EditPlan {
  if (plan.id !== saved.id || plan.source.videoId !== saved.source.videoId || plan.source.src !== saved.source.src) {
    throw new Error("The edit must use the saved clip.");
  }
  if (!(plan.durationSec > 0 && plan.durationSec <= 180 && plan.fps > 0 && plan.fps <= 60)) {
    throw new Error("The edit has an unsupported duration or frame rate.");
  }
  if (![plan.width, plan.height].every((value) => Number.isInteger(value) && value > 0 && value <= 3840)) throw new Error("The edit has unsupported preview dimensions.");
  const music = plan.music ? library.music.find((track) => track.id === plan.music!.trackId) : null;
  if (plan.music && !music) throw new Error("The selected music track is unavailable.");
  const sounds = plan.sfx.map((sound) => {
    const asset = library.sfx.find((item) => item.id === sound.sfxId);
    if (!asset) throw new Error("A selected sound effect is unavailable.");
    return { ...sound, url: asset.url };
  });
  const supporting = (plan.supporting ?? []).map((requested) => {
    const asset = trusted?.supporting.find((item) => item.analysis.videoId === requested.videoId);
    if (!asset) throw new Error("A supporting video is unavailable.");
    const analysis = asset.analysis;
    if (requested.src !== analysis.src || requested.frames.some((frame) => !analysis.frames.some((known) => known.t === frame.t && known.url === frame.url))) throw new Error("Supporting media URLs must match the registered footage.");
    return { videoId: analysis.videoId, name: asset.name, description: asset.description, src: analysis.src, width: analysis.width, height: analysis.height, durationSec: analysis.durationSec, frames: analysis.frames };
  });
  const result: EditPlan = {
    ...plan,
    source: trusted ? { videoId: trusted.analysis.videoId, src: trusted.analysis.src, width: trusted.analysis.width, height: trusted.analysis.height } : { ...saved.source },
    ...(plan.supporting ? { supporting } : {}),
    music: plan.music && music ? { ...plan.music, url: music.url } : null,
    sfx: sounds,
  };
  const quality = checkEditQuality(result, trusted?.analysis);
  if (!quality.passed) throw new Error(quality.errors.join(" "));
  return { ...result, quality };
}

/** Render the trusted current edit at the requested output settings. */
export function prepareExportPlan(saved: EditPlan, request: z.infer<typeof ExportRequest>, library: Library, trusted?: TrustedPlanAssets): EditPlan {
  const effective = prepareEffectivePlan(saved, request.editPlan ?? saved, library, trusted);
  const size = ASPECT_SIZE[effective.aspect];
  const scale = request.resolution === "720p" ? 2 / 3 : 1;
  const plan = {
    ...effective,
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
    captions: { ...effective.captions, enabled: request.burnCaptions && effective.captions.enabled },
  };
  const quality = checkEditQuality(plan, trusted?.analysis);
  if (!quality.passed) throw new Error(quality.errors.join(" "));
  return { ...plan, quality };
}

/** Bind the submitted preview to the canonical render without adding capabilities to either hash. */
export async function exportFingerprints(submitted: EditPlan, rendered: EditPlan, settings: ExportSettings): Promise<ExportFingerprints> {
  const { fingerprintPlan } = await import("@unfold/video/review");
  const [submittedInputFingerprint, renderedPlanFingerprint] = await Promise.all([fingerprintPlan(submitted), fingerprintPlan(rendered)]);
  return { submittedInputFingerprint, renderedPlanFingerprint, settings: { resolution: settings.resolution, burnCaptions: settings.burnCaptions } };
}
