import { mkdir, realpath, rm, stat, statfs } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { requireUser } from "@/lib/auth/server";
import { getLibrary, PUBLIC_DIR, REPO_ROOT, store, storage } from "@/server/store";
import { trustedPlanInputs } from "@/server/plan-access";
import { ExportRequest, prepareExportPlan, exportFingerprints } from "@/server/export-plan";
import { StorageError } from "@/server/private-storage";
import { apiError } from "@/server/api-errors";
import { sse } from "@/server/sse";

export const maxDuration = 600;
let rendering = false;

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  let ownsRenderLock = false;
  const releaseRenderLock = () => {
    if (!ownsRenderLock) return;
    ownsRenderLock = false;
    rendering = false;
  };
  try {
    const input = await req.json().catch(() => null);
    const parsed = ExportRequest.safeParse(input);
    if (!parsed.success) throw new StorageError(400, "Invalid export settings or edit plan.");
    const saved = await store.getPlan(user, parsed.data.planId);
    const trusted = await trustedPlanInputs(user, saved, parsed.data.editPlan ?? saved.editPlan);
    let plan;
    try { plan = prepareExportPlan(saved.editPlan, parsed.data, await getLibrary(), trusted); }
    catch (error) { throw new StorageError(400, error instanceof Error ? error.message : "Invalid edit plan."); }
    const fingerprints = await exportFingerprints(input?.editPlan ?? saved.editPlan, plan, { resolution: parsed.data.resolution, burnCaptions: parsed.data.burnCaptions });
    if (rendering) throw new StorageError(429, "An export is already running. Try again when it finishes.");
    rendering = true;
    ownsRenderLock = true;
    const exportId = `${saved.editPlan.id}-${randomUUID()}`;
    const outDir = path.join(storage.projectDir(saved.projectId), "media", "exports");
    await mkdir(outDir, { recursive: true, mode: 0o700 });
    const disk = await statfs(outDir);
    if (disk.bavail * disk.bsize < 1024 * 1024 * 1024) throw new StorageError(507, "Free at least 1 GB of storage before exporting.");
    const privatePaths = [plan.source.src, ...(plan.supporting ?? []).map((asset) => asset.src)];
    const access = await storage.createRenderAccess(user, saved.projectId, privatePaths);
    const origin = new URL(req.url).origin;
    const rendererUrl = (src: string) => {
      const url = new URL(src, origin);
      url.searchParams.set("render", access.token);
      return url.href;
    };
    const renderPlanInput = { ...plan, source: { ...plan.source, src: rendererUrl(plan.source.src) }, supporting: plan.supporting?.map((asset) => ({ ...asset, src: rendererUrl(asset.src) })) };
    return sse(async (send, signal) => {
      const fileName = `${exportId}.mp4`;
      const outputPath = path.join(outDir, fileName);
      let completed = false;
      try {
        const { renderPlan } = await import("@unfold/video/render");
        let last = 0;
        await renderPlan(renderPlanInput, outputPath, { publicDir: PUBLIC_DIR, entryPoint: path.join(REPO_ROOT, "packages/video/src/entry.ts"), assetBase: origin, signal, onProgress: (progress) => { if (progress - last >= 0.02 || progress === 1) { last = progress; send("progress", { progress }); } } });
        await storage.registerReference(user, saved.projectId, "exports", fileName);
        completed = true;
        let review: Awaited<ReturnType<typeof import("@unfold/video/review")["reviewRenderedPlan"]>> | undefined;
        let reviewError: string | undefined;
        let reviewUrl: string | undefined;
        let contactSheetUrl: string | undefined;
        try {
          const { reviewRenderedPlan } = await import("@unfold/video/review");
          review = await reviewRenderedPlan(plan, {
            outputPath, reviewDir: path.join(outDir, exportId), publicDir: PUBLIC_DIR, analysis: trusted.analysis, signal,
            resolveAsset: async (src) => {
              if (src.startsWith(`/media/${saved.projectId}/`)) return storage.mediaPath(user, src.slice("/media/".length).split("/"));
              if (!src.startsWith("/assets/") || src.includes("?") || src.includes("#")) return null;
              const file = await realpath(path.join(PUBLIC_DIR, src)).catch(() => null);
              const root = await realpath(path.join(PUBLIC_DIR, "assets"));
              return file?.startsWith(root + path.sep) ? file : null;
            },
          });
          const artifacts = [review.artifacts.report, review.artifacts.contactSheet, ...review.artifacts.frames.map((frame) => frame.file)].filter(Boolean);
          for (const artifact of artifacts) {
            const key = `${exportId}/${artifact}`;
            const file = path.resolve(outDir, key);
            if (!file.startsWith(path.join(outDir, exportId) + path.sep) || !(await stat(file)).isFile()) throw new Error("Review artifact unavailable.");
            await storage.registerReference(user, saved.projectId, "exports", key);
          }
          reviewUrl = `/media/${saved.projectId}/exports/${exportId}/${review.artifacts.report}`;
          if (review.artifacts.contactSheet) contactSheetUrl = `/media/${saved.projectId}/exports/${exportId}/${review.artifacts.contactSheet}`;
        } catch {
          reviewError = "The MP4 is ready, but its automatic review is incomplete. Inspect it before posting.";
          review = undefined;
        }
        send("ready", { url: `/media/${saved.projectId}/exports/${fileName}`, ...fingerprints, review, reviewUrl, contactSheetUrl, reviewError });
      } finally {
        if (!completed) await rm(outputPath, { force: true });
        try { await access.release(); }
        finally { releaseRenderLock(); }
      }
    }, req.signal);
  } catch (error) { releaseRenderLock(); return apiError(error); }
}
