import { requireUser } from "@/lib/auth/server";
import { storage } from "@/server/store";
import { apiError } from "@/server/api-errors";
import { StorageError } from "@/server/private-storage";

export const maxDuration = 300;
const inflight = new Map<string, { language: string; promise: Promise<unknown> }>();

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (process.env.NEXT_PUBLIC_UNFOLD_BACKEND === "supabase") return Response.json({error:"Use the background workflow to continue."},{status:409});
  try {
    const { videoId, language: requestedLanguage } = await req.json().catch(() => ({})) as { videoId?: string; language?: unknown };
    if (typeof videoId !== "string") throw new StorageError(400, "videoId is required.");
    const language = requestedLanguage ?? process.env.UNFOLD_STT_LANGUAGE ?? "en";
    if (language !== "en" && language !== "hi" && language !== "auto") throw new StorageError(400, "Choose en, hi or auto for transcription.");
    const paths = await storage.assetPaths(user, videoId);
    const key = `${user.id}:${videoId}`;
    let job = inflight.get(key);
    if (job && job.language !== language) throw new StorageError(409, "Wait for the current analysis before changing its language.");
    if (!job) {
      const promise = (async () => {
        const release = await storage.acquireLease(user, paths.asset.projectId, "analysis");
        try {
          const media = await import("@unfold/media");
          try {
            const result = await media.analyzeVideo(paths.upload, { videoId, mediaDir: paths.mediaDir, urlPrefix: paths.urlPrefix, language, signal: req.signal, maxDurationSec: 180, reuseExisting: true });
            await storage.updateAsset(user, paths.asset.projectId, videoId, { status: "analyzed" });
            return result;
          } catch (error) {
            if (error instanceof media.MediaError) throw new StorageError(error.code === "CANCELLED" ? 499 : 422, error.message);
            throw error;
          }
        } finally { await release(); }
      })().finally(() => inflight.delete(key));
      job = { language, promise };
      inflight.set(key, job);
    }
    const result = await job.promise as { analysis: unknown; timings: Record<string, number>; cached?: boolean };
    return Response.json({ analysis: result.analysis, timings: result.timings, cached: result.cached ?? false, projectId: paths.asset.projectId });
  } catch (error) { return apiError(error); }
}
