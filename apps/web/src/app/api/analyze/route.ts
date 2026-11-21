import { readdir } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/auth/server";
import { MEDIA_DIR, UPLOAD_DIR, getAnalysis } from "@/server/store";

export const maxDuration = 300;

const inflight = new Map<string, Promise<unknown>>();

/** POST {videoId} → MediaAnalysis (cached after the first run). */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { videoId } = (await req.json().catch(() => ({}))) as { videoId?: string };
  if (!videoId || !/^[A-Za-z0-9_-]{1,80}$/.test(videoId)) return Response.json({ error: "videoId is required" }, { status: 400 });

  const cached = await getAnalysis(videoId);
  if (cached) return Response.json({ analysis: cached, cached: true });

  const upload = (await readdir(UPLOAD_DIR).catch(() => [] as string[])).find((f) => f.startsWith(`${videoId}.`));
  if (!upload) return Response.json({ error: "Unknown videoId" }, { status: 404 });

  let job = inflight.get(videoId);
  if (!job) {
    const { analyzeVideo } = await import("@unfold/media");
    job = analyzeVideo(path.join(UPLOAD_DIR, upload), { videoId, mediaDir: MEDIA_DIR, urlPrefix: "/media" }).finally(() => inflight.delete(videoId));
    inflight.set(videoId, job);
  }
  try {
    const result = (await job) as { analysis: unknown; timings: Record<string, number> };
    return Response.json({ analysis: result.analysis, timings: result.timings });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
