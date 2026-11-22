import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { analyzeStyle } from "@unfold/agent";
import { requireUser } from "@/lib/auth/server";
import { createExecution } from "@/lib/auth/execution";
import { storage, frameLoader, store } from "@/server/store";
import { apiError } from "@/server/api-errors";
import { StorageError, type PrivateAsset } from "@/server/private-storage";

export const maxDuration = 300;
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (process.env.NEXT_PUBLIC_UNFOLD_BACKEND === "supabase") return Response.json({error:"Use the background workflow to continue."},{status:409});
  try {
    const multipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
    const form = multipart ? await req.formData() : null;
    const body = form ? null : await req.json().catch(() => ({})) as { url?: string; primaryVideoId?: string };
    const projectId = String(form?.get("primaryVideoId") ?? body?.primaryVideoId ?? "");
    await storage.getProject(user, projectId);
    const videoId = `s_${randomUUID().replaceAll("-", "")}`;
    const file = form?.get("file");
    const url = body?.url;
    if (form && (!(file instanceof File) || !file.size || file.size > 500 * 1024 * 1024)) throw new StorageError(400, "Upload a reference video smaller than 500 MB.");
    if (!form && (typeof url !== "string" || !/^https?:\/\//.test(url))) throw new StorageError(400, "A reference video link is required.");
    const extension = file instanceof File ? path.extname(file.name).toLowerCase() : ".mp4";
    if (![".mp4", ".mov", ".m4v", ".webm", ".mkv"].includes(extension)) throw new StorageError(415, "Upload a reference video file.");
    const release = await storage.acquireLease(user, projectId, "reference");
    let execution;
    try { execution = await createExecution(user, req.signal); }
    catch (error) { await release(); throw error; }
    try {
      const asset: PrivateAsset = { assetId: videoId, videoId, projectId, primaryVideoId: projectId, role: "reference", description: "", filename: file instanceof File ? file.name.slice(0, 160) : "Reference video", extension, status: "uploaded", createdAt: Date.now() };
      await storage.addAsset(user, projectId, asset);
      const paths = await storage.assetPaths(user, videoId);
      const media = await import("@unfold/media");
      const options = { videoId, mediaDir: paths.mediaDir, urlPrefix: paths.urlPrefix, skipProxy: true, maxFrames: 8, signal: req.signal, maxDurationSec: 180, reuseExisting: true };
      let reference;
      try {
      if (file instanceof File) {
        await mkdir(path.dirname(paths.upload), { recursive: true, mode: 0o700 });
        await writeFile(paths.upload, Buffer.from(await file.arrayBuffer()), { flag: "wx", mode: 0o600 });
        reference = await media.analyzeReferenceFile(paths.upload, options);
      } else reference = await media.fetchReference(url!, options);
      } catch (error) {
        if (error instanceof media.MediaError) throw new StorageError(error.code === "CANCELLED" ? 499 : 422, error.message);
        throw error;
      }
      await storage.updateAsset(user, projectId, videoId, { status: "analyzed" });
      const { profile, stats } = await analyzeStyle(reference.analysis, frameLoader(user, projectId), { cutsPerMinute: reference.stats.cutsPerMinute, avgShotSec: reference.stats.avgShotSec }, execution.config);
      await store.putStyle(user, projectId, videoId, { profile, sourceUrl: url ?? null });
      return Response.json({ styleId: videoId, profile, cutStats: reference.stats, title: reference.title ?? asset.filename, stats, projectId });
    } finally { try { await execution.dispose(); } finally { await release(); } }
  } catch (error) { return apiError(error); }
}
