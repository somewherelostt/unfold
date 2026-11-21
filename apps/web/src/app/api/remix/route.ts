import { remixPlan } from "@unfold/agent";
import { requireUser } from "@/lib/auth/server";
import { getAnalysis, getLibrary, loadFrame, store } from "@/server/store";
import { sse } from "@/server/sse";

export const maxDuration = 120;

/**
 * POST {planId, message} → SSE
 *   event "delta" {text}            (raw model output as it streams)
 *   event "plan"  {editPlan, agentPlan, stats}
 *   event "done"
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { planId, message } = (await req.json().catch(() => ({}))) as { planId?: string; message?: string };
  if (!planId || !message?.trim()) return Response.json({ error: "planId and message are required" }, { status: 400 });
  const stored = await store.getPlan(planId);
  if (!stored) return Response.json({ error: "Unknown planId" }, { status: 404 });
  const analysis = await getAnalysis(stored.videoId);
  if (!analysis) return Response.json({ error: "Source analysis missing" }, { status: 409 });
  const library = await getLibrary();

  return sse(async (send, signal) => {
    const r = await remixPlan({ analysis, library, loadFrame }, stored.agentPlan, message.trim(), {
      signal,
      onDelta: (t) => send("delta", { text: t }),
    });
    await store.putPlan({ editPlan: r.editPlan, agentPlan: r.agentPlan, videoId: stored.videoId, createdAt: Date.now() });
    send("plan", { editPlan: r.editPlan, agentPlan: r.agentPlan, stats: r.stats });
  }, req.signal);
}
