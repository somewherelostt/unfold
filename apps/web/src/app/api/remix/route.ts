import { remixPlan } from "@unfold/agent";
import { EditPlan } from "@unfold/core";
import { requireUser } from "@/lib/auth/server";
import { createExecution } from "@/lib/auth/execution";
import { getAnalysis, getLibrary, frameLoader, resolveSupporting, storage, store } from "@/server/store";
import { apiError } from "@/server/api-errors";
import { StorageError } from "@/server/private-storage";
import { sse } from "@/server/sse";
import { validateSavedEdit } from "@/server/plan-access";
import { agentErrorPayload } from "@/server/agent-errors";

export const maxDuration = 120;
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (process.env.NEXT_PUBLIC_UNFOLD_BACKEND === "supabase") return Response.json({error:"Use the background workflow to continue."},{status:409});
  try {
    const { planId, message, editPlan } = await req.json().catch(() => ({})) as { planId?: string; message?: string; editPlan?: unknown };
    if (typeof planId !== "string" || typeof message !== "string" || !message.trim() || message.length > 8000) throw new StorageError(400, "planId and message are required.");
    const saved = await store.getPlan(user, planId);
    const parsed = EditPlan.safeParse(editPlan === undefined ? saved.editPlan : editPlan);
    if (!parsed.success) throw new StorageError(400, "Invalid current edit plan.");
    const currentEdit = await validateSavedEdit(user, saved, parsed.data);
    const analysis = await getAnalysis(user, saved.videoId);
    if (!analysis) throw new StorageError(409, "Source analysis is unavailable.");
    const supporting = await resolveSupporting(user, saved.projectId, (currentEdit.supporting ?? []).map((asset) => asset.videoId));
    const library = await getLibrary();
    const release = await storage.acquireLease(user, saved.projectId, "remix");
    let execution;
    try { execution = await createExecution(user, req.signal); }
    catch (error) { await release(); throw error; }
    return sse(async (send, signal) => {
      try {
        const result = await remixPlan({ analysis, library, supporting, config: execution.config, loadFrame: frameLoader(user, saved.projectId) }, saved.agentPlan, message.trim(), { signal, currentEdit, onDelta: (text) => send("delta", { text }) });
        const stored = await store.putPlan(user, saved.projectId, { editPlan: result.editPlan, agentPlan: result.agentPlan, videoId: saved.videoId, createdAt: Date.now() });
        send("plan", { editPlan: stored.editPlan, agentPlan: stored.agentPlan, stats: result.stats, revision: stored.revision, updatedAt: stored.updatedAt, projectId: stored.projectId });
      } finally { try { await execution.dispose(); } finally { await release(); } }
    }, req.signal, (error) => agentErrorPayload(error, req.signal));
  } catch (error) {
    if (req.signal.aborted) {
      const failure = agentErrorPayload(error, req.signal);
      return Response.json({ error: failure.message, ...failure }, { status: 499 });
    }
    return apiError(error);
  }
}
