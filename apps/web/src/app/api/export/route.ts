import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { requireUser } from "@/lib/auth/server";
import { getLibrary, MEDIA_DIR, PUBLIC_DIR, REPO_ROOT, store } from "@/server/store";
import { ExportRequest, prepareExportPlan } from "@/server/export-plan";
import { sse } from "@/server/sse";

export const maxDuration = 600;

/**
 * POST {planId, editPlan?, resolution?, burnCaptions?} → SSE
 *   event "progress" {progress: 0..1}
 *   event "ready"    {url}   (unique MP4 URL for each render)
 *   event "done"
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const parsed = ExportRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid export settings or edit plan." }, { status: 400 });
  const { planId } = parsed.data;
  const stored = await store.getPlan(planId);
  if (!stored) return Response.json({ error: "Unknown planId" }, { status: 404 });
  let plan;
  try {
    plan = prepareExportPlan(stored.editPlan, parsed.data, await getLibrary());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid edit plan." }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const fileName = `${planId}-${randomUUID()}.mp4`;
  return sse(async (send, signal) => {
    const { renderPlan } = await import("@unfold/video/render");
    const outDir = path.join(MEDIA_DIR, "exports");
    await mkdir(outDir, { recursive: true });
    let last = 0;
    await renderPlan(plan, path.join(outDir, fileName), {
      publicDir: PUBLIC_DIR,
      entryPoint: path.join(REPO_ROOT, "packages/video/src/entry.ts"),
      assetBase: origin, // /media/... and /assets/... are fetched from this server
      signal,
      onProgress: (p) => {
        if (p - last >= 0.02 || p === 1) {
          last = p;
          send("progress", { progress: p });
        }
      },
    });
    send("ready", { url: `/media/exports/${fileName}` });
  }, req.signal);
}
