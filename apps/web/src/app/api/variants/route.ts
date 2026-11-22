import { generateVariants } from "@unfold/agent";
import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { createExecution } from "@/lib/auth/execution";
import { getAnalysis, getLibrary, frameLoader, resolveSupporting, storage, store, type GenerationRequest } from "@/server/store";
import { StorageError } from "@/server/private-storage";
import { apiError } from "@/server/api-errors";
import { sse } from "@/server/sse";
import { agentErrorPayload, variantErrorPayload } from "@/server/agent-errors";

export const maxDuration = 300;
const Input = z.object({ videoId: z.string(), prompt: z.string().max(8000).default(""), styleId: z.string().optional(), aspect: z.enum(["9:16", "1:1", "16:9"]).optional(), count: z.number().int().min(1).max(9).default(1), supportingAssetIds: z.array(z.string()).max(4).default([]) });

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const body = Input.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new StorageError(400, "Invalid generation request.");
    const input = body.data;
    const primary = await storage.getAsset(user, input.videoId);
    if (primary.role !== "primary") throw new StorageError(404, "Not found.");
    const analysis = await getAnalysis(user, input.videoId);
    if (!analysis) throw new StorageError(409, "Analyze the video first.");
    const supporting = await resolveSupporting(user, primary.projectId, input.supportingAssetIds);
    const style = input.styleId ? await store.getStyle(user, input.styleId) : null;
    if (style && style.projectId !== primary.projectId) throw new StorageError(404, "Not found.");
    const library = await getLibrary();
    const startedAt = Date.now();
    const release = await storage.acquireLease(user, primary.projectId, "generation");
    let execution;
    try { execution = await createExecution(user, req.signal); }
    catch (error) { await release(); throw error; }
    const count = user.dev ? Math.min(3, input.count) : input.count;
    return sse(async (send, signal) => {
      try {
        send("start", { count, startedAt, executionMode: execution.mode, startupMs: Date.now() - startedAt });
        let ok = 0; let tokens = 0; let tpsSum = 0;
        for await (const variant of generateVariants({ analysis, library, loadFrame: frameLoader(user, primary.projectId), supporting, config: execution.config }, input.prompt, { count, style: style?.profile, aspect: input.aspect, signal })) {
          if (variant.result) {
            ok++; tokens += variant.result.stats.outputTokens; tpsSum += variant.result.stats.tps;
            const generationRequest: GenerationRequest = {
              version: 1, receivedBrief: input.prompt,
              ...(input.aspect === undefined ? {} : { requestedAspect: input.aspect }),
              supportingAssetIds: [...input.supportingAssetIds],
              ...(input.styleId === undefined ? {} : { styleId: input.styleId }),
              direction: variant.direction, createdAt: startedAt,
            };
            const stored = await store.putPlan(user, primary.projectId, { editPlan: variant.result.editPlan, agentPlan: variant.result.agentPlan, videoId: analysis.videoId, createdAt: Date.now(), generationRequest });
            send("variant", { index: variant.index, direction: variant.direction, editPlan: stored.editPlan, agentPlan: stored.agentPlan, stats: variant.result.stats, projectId: primary.projectId, revision: stored.revision, updatedAt: stored.updatedAt, generationRequest: stored.generationRequest });
          } else send("variant-error", { index: variant.index, ...variantErrorPayload(variant.errorCode, signal) });
        }
        send("summary", { count, ok, wallMs: Date.now() - startedAt, outputTokens: tokens, avgTps: ok ? Math.round(tpsSum / ok) : 0 });
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
