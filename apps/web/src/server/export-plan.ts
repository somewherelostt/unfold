import { ASPECT_SIZE, EditPlan, type Library } from "@unfold/core";
import { z } from "zod";

export const ExportRequest = z.object({
  planId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  editPlan: EditPlan.optional(),
  resolution: z.enum(["720p", "1080p"]).default("1080p"),
  burnCaptions: z.boolean().default(true),
});

/** Render the current preview, retaining the saved source and known library URLs. */
export function prepareExportPlan(saved: EditPlan, request: z.infer<typeof ExportRequest>, library: Library): EditPlan {
  const plan = request.editPlan ?? saved;
  if (plan.id !== saved.id || plan.source.videoId !== saved.source.videoId || plan.source.src !== saved.source.src) {
    throw new Error("The edit must use the saved clip.");
  }
  if (!(plan.durationSec > 0 && plan.durationSec <= 180 && plan.fps > 0 && plan.fps <= 60)) {
    throw new Error("The edit has an unsupported duration or frame rate.");
  }
  const music = plan.music ? library.music.find((track) => track.id === plan.music!.trackId) : null;
  if (plan.music && !music) throw new Error("The selected music track is unavailable.");
  const sounds = plan.sfx.map((sound) => {
    const asset = library.sfx.find((item) => item.id === sound.sfxId);
    if (!asset) throw new Error("A selected sound effect is unavailable.");
    return { ...sound, url: asset.url };
  });
  const size = ASPECT_SIZE[plan.aspect];
  const scale = request.resolution === "720p" ? 2 / 3 : 1;
  return {
    ...plan,
    source: { ...saved.source },
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
    captions: { ...plan.captions, enabled: request.burnCaptions && plan.captions.enabled },
    music: plan.music && music ? { ...plan.music, url: music.url } : null,
    sfx: sounds,
  };
}
