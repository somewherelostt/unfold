import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { analyzeStyle } from "@unfold/agent";
import { requireUser } from "@/lib/auth/server";
import { MEDIA_DIR, UPLOAD_DIR, loadFrame, store } from "@/server/store";

export const maxDuration = 300;

/**
 * Copy the style of an inspiration video.
 * POST JSON {url} (public short-form video link) or multipart {file} (fallback)
 *   → {styleId, profile, cutStats, title, stats}
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const media = await import("@unfold/media");
  const styleId = `s_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const opts = { videoId: styleId, mediaDir: MEDIA_DIR, urlPrefix: "/media", skipProxy: true, maxFrames: 10 };

  let ref: { analysis: any; stats: any; sourceUrl: string | null; title: string | null };
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
      await mkdir(UPLOAD_DIR, { recursive: true });
      const p = path.join(UPLOAD_DIR, `${styleId}${path.extname(file.name) || ".mp4"}`);
      await writeFile(p, Buffer.from(await file.arrayBuffer()));
      const r = await media.analyzeReferenceFile(p, opts);
      ref = { analysis: r.analysis, stats: (r as any).stats ?? media.cutStats(r.analysis), sourceUrl: null, title: file.name };
    } else {
      const { url } = (await req.json().catch(() => ({}))) as { url?: string };
      if (!url || !/^https?:\/\//.test(url)) return Response.json({ error: "A video link is required" }, { status: 400 });
      const r = await media.fetchReference(url, opts);
      ref = { analysis: r.analysis, stats: r.stats, sourceUrl: r.sourceUrl, title: r.title };
    }
  } catch (e) {
    return Response.json(
      { error: "Couldn't fetch that video. Upload the file instead.", detail: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }

  const { profile, stats } = await analyzeStyle(ref.analysis, loadFrame, {
    cutsPerMinute: ref.stats.cutsPerMinute,
    avgShotSec: ref.stats.avgShotSec,
  });
  await store.putStyle(styleId, { profile, sourceUrl: ref.sourceUrl });
  return Response.json({ styleId, profile, cutStats: ref.stats, title: ref.title, stats });
}
