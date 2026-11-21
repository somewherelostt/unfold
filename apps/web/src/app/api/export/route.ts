import { mkdir } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/auth/server";
import { MEDIA_DIR, PUBLIC_DIR, REPO_ROOT, store } from "@/server/store";
import { sse } from "@/server/sse";

export const maxDuration = 600;

/**
 * POST {planId} → SSE
 *   event "progress" {progress: 0..1}
 *   event "ready"    {url}   (MP4 served from /media/exports/<planId>.mp4)
 *   event "done"
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { planId } = (await req.json().catch(() => ({}))) as { planId?: string };
  if (!planId) return Response.json({ error: "planId is required" }, { status: 400 });
  const stored = await store.getPlan(planId);
  if (!stored) return Response.json({ error: "Unknown planId" }, { status: 404 });

  const origin = new URL(req.url).origin;
  return sse(async (send) => {
    const { renderPlan } = await import("@unfold/video/render");
    const outDir = path.join(MEDIA_DIR, "exports");
    await mkdir(outDir, { recursive: true });
    let last = 0;
    await renderPlan(stored.editPlan, path.join(outDir, `${planId}.mp4`), {
      publicDir: PUBLIC_DIR,
      entryPoint: path.join(REPO_ROOT, "packages/video/src/entry.ts"),
      assetBase: origin, // /media/... and /assets/... are fetched from this server
      onProgress: (p) => {
        if (p - last >= 0.02 || p === 1) {
          last = p;
          send("progress", { progress: p });
        }
      },
    });
    send("ready", { url: `/media/exports/${planId}.mp4` });
  }, req.signal);
}
