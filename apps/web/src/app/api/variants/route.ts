import { generateVariants } from "@unfold/agent";
import { requireUser } from "@/lib/auth/server";
import { getAnalysis, getLibrary, loadFrame, store } from "@/server/store";
import { sse } from "@/server/sse";

export const maxDuration = 300;

/**
 * POST {videoId, prompt, styleId?, aspect?, count?} → SSE
 *   event "start"   {count, startedAt}
 *   event "variant" {index, direction, editPlan, agentPlan, stats}   (as each lands)
 *   event "variant-error" {index, message}
 *   event "summary" {count, ok, wallMs, outputTokens, avgTps}
 *   event "done"
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = (await req.json().catch(() => ({}))) as { videoId?: string; prompt?: string; styleId?: string; aspect?: string; count?: number };
  if (!body.videoId) return Response.json({ error: "videoId is required" }, { status: 400 });
  const analysis = await getAnalysis(body.videoId);
  if (!analysis) return Response.json({ error: "Analyse the video first" }, { status: 409 });
  const library = await getLibrary();
  const style = body.styleId ? (await store.getStyle(body.styleId))?.profile ?? null : null;
  const count = Math.max(1, Math.min(9, body.count ?? 9));

  return sse(async (send, signal) => {
    const t0 = Date.now();
    send("start", { count, startedAt: t0 });
    let ok = 0;
    let tokens = 0;
    let tpsSum = 0;
    for await (const v of generateVariants({ analysis, library, loadFrame }, body.prompt ?? "", { count, style, aspect: body.aspect, signal })) {
      if (v.result) {
        ok++;
        tokens += v.result.stats.outputTokens;
        tpsSum += v.result.stats.tps;
        await store.putPlan({ editPlan: v.result.editPlan, agentPlan: v.result.agentPlan, videoId: analysis.videoId, createdAt: Date.now() });
        send("variant", { index: v.index, direction: v.direction, editPlan: v.result.editPlan, agentPlan: v.result.agentPlan, stats: v.result.stats });
      } else {
        send("variant-error", { index: v.index, message: v.error });
      }
    }
    send("summary", { count, ok, wallMs: Date.now() - t0, outputTokens: tokens, avgTps: ok ? Math.round(tpsSum / ok) : 0 });
  }, req.signal);
}
