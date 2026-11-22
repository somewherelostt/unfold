import {
  JobFault, createJobQueue, encodeJobEvent, isJobFault, isTerminal, watchJob, type JobQueue,
} from "@unfold/jobs";
import type { EditPlan, MediaAnalysis } from "@unfold/core";
import { contentFingerprint, isStorageFailure, readJobResult, type RenderSnapshot } from "./job-bindings.ts";
import { PrivateStorage, StorageError, type Owner } from "./private-storage.ts";
import type { StoredPlan } from "./store";

export type ClientJobRequest = { kind: "analysis"; videoId: string; idempotencyKey: string } | {
  kind: "render"; planId: string; editPlan?: EditPlan; resolution?: "720p" | "1080p"; burnCaptions?: boolean; idempotencyKey: string;
};
export type JobsDependencies = {
  storage: PrivateStorage;
  queue: JobQueue;
  loadPlan: (owner: Owner, id: string) => Promise<StoredPlan>;
  prepareRender: (owner: Owner, saved: StoredPlan, body: Extract<ClientJobRequest, { kind: "render" }>) => Promise<{ plan: EditPlan; analysis: MediaAnalysis }>;
};
function parseRequest(value: unknown): ClientJobRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JobFault("INVALID_REQUEST", "Invalid job settings.");
  const body = value as Record<string, unknown>;
  const allowed = body.kind === "analysis" ? ["kind", "videoId", "idempotencyKey"] : ["kind", "planId", "editPlan", "resolution", "burnCaptions", "idempotencyKey"];
  if (Object.keys(body).some((key) => !allowed.includes(key)) || !["analysis", "render"].includes(String(body.kind))) throw new JobFault("INVALID_REQUEST", "Invalid job settings.");
  const identifier = body.kind === "analysis" ? body.videoId : body.planId;
  if (typeof identifier !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(identifier) || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9_.:-]{8,160}$/.test(body.idempotencyKey)) throw new JobFault("INVALID_REQUEST", "A valid input and idempotency key are required.");
  if (body.kind === "render" && ((body.resolution !== undefined && body.resolution !== "720p" && body.resolution !== "1080p") || (body.burnCaptions !== undefined && typeof body.burnCaptions !== "boolean"))) throw new JobFault("INVALID_REQUEST", "Invalid export settings.");
  return structuredClone(value) as ClientJobRequest;
}
export function jobApiError(error: unknown): Response {
  if (isJobFault(error)) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
  if (isStorageFailure(error)) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
  return Response.json({ error: "The job request could not be completed." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
}
export const jobJson = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

export function createJobsApi(dependencies: JobsDependencies) {
  const { queue, storage } = dependencies;
  const lookup = async (owner: Owner, id: string) => {
    const found = await queue.getForOwner(owner.id, id);
    await storage.getProject(owner, found.context.projectId);
    if (isTerminal(found.job.state)) await storage.unregisterJob(owner, found.context.projectId, id);
    return found;
  };
  return {
    async enqueue(owner: Owner, value: unknown) {
      const body = parseRequest(value);
      const saved = body.kind === "render" ? await dependencies.loadPlan(owner, body.planId) : null;
      const projectId = saved ? saved.projectId : (await storage.getAsset(owner, (body as Extract<ClientJobRequest, { kind: "analysis" }>).videoId)).projectId;
      await storage.getProject(owner, projectId);
      const context = { ownerId: owner.id, projectId };
      const digest = contentFingerprint({ ownerId: owner.id, projectId, key: body.idempotencyKey });
      const jobId = `job_${digest}`, snapshotId = `input_${digest}`;
      const release = await storage.acquireLease(owner, projectId, "enqueue-job");
      try {
        await storage.registerReference(owner, projectId, "jobs", jobId);
        let input: { kind: "upload" | "plan"; id: string; revision?: string };
        if (body.kind === "analysis") input = { kind: "upload", id: body.videoId };
        else {
          const fingerprint = contentFingerprint({ ...body, resolution: body.resolution ?? "1080p", burnCaptions: body.burnCaptions ?? true });
          let snapshot: RenderSnapshot | null = null;
          try { snapshot = await storage.getJobInput<RenderSnapshot>(owner, projectId, snapshotId); }
          catch (error) { if (!isStorageFailure(error) || error.status !== 404) throw error; }
          if (snapshot && snapshot.clientFingerprint !== fingerprint) throw new JobFault("IDEMPOTENCY_CONFLICT", "This export key was used with different settings.", 409);
          if (!snapshot) {
            const prepared = await dependencies.prepareRender(owner, saved!, body);
            const planFingerprint = contentFingerprint(prepared.plan);
            snapshot = { version: 1, kind: "render", clientFingerprint: fingerprint, planFingerprint,
              submittedInputFingerprint: contentFingerprint(body.editPlan ?? saved!.editPlan), renderedPlanFingerprint: planFingerprint,
              settings: { resolution: body.resolution ?? "1080p", burnCaptions: body.burnCaptions ?? true }, plan: prepared.plan, analysis: prepared.analysis };
          }
          const immutable = await storage.putJobInput(owner, projectId, snapshotId, snapshot);
          input = { kind: "plan", id: immutable.id, revision: immutable.revision };
        }
        // No automatic retry of published output or paid generation. A new click is an explicit new job.
        const result = await queue.enqueue(context, { kind: body.kind, input, idempotencyKey: body.idempotencyKey }, { id: jobId });
        if (isTerminal(result.job.state)) await storage.unregisterJob(owner, projectId, jobId);
        return result;
      } catch (error) {
        try { const prior = await queue.getForOwner(owner.id, jobId); if (isTerminal(prior.job.state)) await storage.unregisterJob(owner, projectId, jobId); }
        catch (lookupError) { if (isJobFault(lookupError) && lookupError.code === "NOT_FOUND") await storage.unregisterJob(owner, projectId, jobId); }
        throw error;
      } finally { await release(); }
    },
    async get(owner: Owner, id: string) { return (await lookup(owner, id)).job; },
    async cancel(owner: Owner, id: string) {
      const { context } = await lookup(owner, id); const job = await queue.cancel(context, id);
      if (isTerminal(job.state)) await storage.unregisterJob(owner, context.projectId, id);
      return job;
    },
    async result(owner: Owner, id: string) {
      const { context, job } = await lookup(owner, id);
      return readJobResult(storage, owner, context.projectId, job);
    },
    async events(owner: Owner, id: string, request: Request): Promise<Response> {
      const { context } = await lookup(owner, id);
      const raw = new URL(request.url).searchParams.get("after") ?? request.headers.get("last-event-id") ?? "0";
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new JobFault("INVALID_CURSOR", "Invalid event cursor.");
      const viewer = new AbortController(); const abort = () => viewer.abort();
      request.signal.addEventListener("abort", abort, { once: true }); if (request.signal.aborted) abort();
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const ping = setInterval(() => { try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { viewer.abort(); } }, 10_000);
          try { for await (const event of watchJob(queue, context, id, { after: Number(raw), signal: viewer.signal })) { controller.enqueue(encoder.encode(encodeJobEvent(event))); if (isTerminal(event.data.state)) await storage.unregisterJob(owner, context.projectId, id); } }
          catch { if (!viewer.signal.aborted) { try { controller.enqueue(encoder.encode("event: error\ndata: {\"message\":\"Reconnect to recover job progress.\"}\n\n")); } catch {} } }
          finally { clearInterval(ping); request.signal.removeEventListener("abort", abort); try { controller.close(); } catch {} }
        },
        cancel() { viewer.abort(); },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
    },
    async drainProject(owner: Owner, projectId: string, ids: string[], timeoutMs = 30_000) {
      await storage.getProject(owner, projectId);
      const contexts = [];
      for (const id of ids) {
        let found;
        try { found = await queue.getForOwner(owner.id, id); }
        catch (error) {
          if (!isJobFault(error) || error.code !== "NOT_FOUND") throw error;
          // A crash after storage preregistration but before SQLite enqueue cannot own execution.
          await storage.unregisterJob(owner, projectId, id);
          continue;
        }
        if (found.context.projectId !== projectId) throw new JobFault("NOT_FOUND", "Job not found.", 404);
        contexts.push(found);
      }
      for (const found of contexts) await queue.cancel(found.context, found.job.id);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if ((await Promise.all(contexts.map(async (found) => isTerminal((await queue.get(found.context, found.job.id)).state)))).every(Boolean)) break;
        if (Date.now() > deadline) throw new JobFault("JOBS_DRAINING", "Project work is still stopping. Try again shortly.", 409);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      for (const found of contexts) { await storage.unregisterJob(owner, projectId, found.job.id); await queue.releaseOutput(found.context, found.job.id); }
    },
  };
}

let defaultApi: ReturnType<typeof createJobsApi> | null = null;
export async function getJobsApi() {
  if (defaultApi) return defaultApi;
  const { storage, store, getLibrary } = await import("./store");
  const { trustedPlanInputs } = await import("./plan-access");
  const { ExportRequest, prepareExportPlan } = await import("./export-plan");
  defaultApi = createJobsApi({ storage, queue: createJobQueue(), loadPlan: store.getPlan,
    prepareRender: async (owner, saved, request) => {
      const parsed = ExportRequest.safeParse(request);
      if (!parsed.success) throw new StorageError(400, "Invalid export settings or edit plan.");
      const trusted = await trustedPlanInputs(owner, saved, parsed.data.editPlan ?? saved.editPlan);
      try { return { plan: prepareExportPlan(saved.editPlan, parsed.data, await getLibrary(), trusted), analysis: trusted.analysis }; }
      catch (error) { throw new StorageError(400, error instanceof Error ? error.message : "Invalid edit plan."); }
    } });
  return defaultApi;
}
