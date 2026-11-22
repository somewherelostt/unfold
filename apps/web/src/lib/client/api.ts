/**
 * Typed client for Unfold's API (routes in app/api, owned by the main session).
 *
 * Live by default. Set NEXT_PUBLIC_UNFOLD_API=mock to use sample fixtures + the real compiler instead.
 *   POST /api/upload     multipart {file}                                  → { videoId }
 *   POST /api/analyze    {videoId}                                         → { analysis }   (10–30s; "sample" = demo)
 *   POST /api/reference  {url,primaryVideoId} | multipart {file,primaryVideoId} → { styleId, profile, cutStats, title, stats }
 *   POST /api/variants   {videoId, prompt, supportingAssetIds?, styleId?, aspect?, count} → SSE start | variant | variant-error | summary | done
 *   POST /api/remix      {planId, message}                                 → SSE delta | plan | done
 *   POST /api/export     {planId, editPlan?, resolution?, burnCaptions?}   → SSE progress | ready | done
 *   GET  /api/plans/:id                                                    → { editPlan, agentPlan, videoId }
 *   GET  /assets/{music,sfx}/manifest.json                                 → MusicTrack[] / SfxItem[]
 */
import { sampleLibrary, type EditPlan, type Library, type MediaAnalysis, type MusicTrack, type SfxItem } from "@unfold/core";
import { fakeStats, mockAgentPlans, mockAnalysis, mockCompile, mockPlanById, mockRegisterUpload, mockRemix } from "./mock";
import type { ExportEvent, GenerateRequest, ReferenceResult, RemixEvent, SupportingResource, VariantsEvent } from "./types";
import { reconcileJob, type JobView } from "./jobs";
import type { ExportReady } from "./types";
import { serviceErrorFields } from "./errors";

export const MOCK = process.env.NEXT_PUBLIC_UNFOLD_API === "mock";
export const DURABLE_JOBS = process.env.NEXT_PUBLIC_UNFOLD_JOBS === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const details = serviceErrorFields(body);
    throw new ApiError((body && (body.message || body.error as string)) || `${res.status} ${res.statusText}`, res.status, details.errorCode, details.retryable);
  }
  return (await res.json()) as T;
}
export class ApiError extends Error {
  constructor(message: string, public status: number, public errorCode?: string, public retryable?: boolean) { super(message); this.name = "ApiError"; }
}
const post = (url: string, body: unknown, signal?: AbortSignal) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });

/** Parse a named-event SSE stream into {type, ...data}. Ignores ping, stops at done. */
async function* sse<T extends { type: string }>(res: Response): AsyncGenerator<T> {
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    const details = serviceErrorFields(body);
    throw new ApiError((body && (body.message || body.error)) || `${res.status} ${res.statusText}`, res.status, details.errorCode, details.retryable);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += value;
      let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (event === "done") return;
        if (event === "ping") continue;
        const payload = data.length ? JSON.parse(data.join("\n")) : {};
        yield { type: event, ...payload } as T;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export async function uploadVideo(file: File, signal?: AbortSignal): Promise<{ videoId: string }> {
  if (MOCK) {
    await sleep(250);
    return { videoId: mockRegisterUpload(file) };
  }
  const fd = new FormData();
  fd.append("file", file);
  return json(await fetch("/api/upload", { method: "POST", body: fd, signal }));
}

/** Reports transferred bytes only. Media analysis remains a separate, indeterminate step. */
export async function uploadSupporting(primaryVideoId: string, file: File, description: string, signal: AbortSignal, progress: (value: number) => void): Promise<{ videoId: string }> {
  signal.throwIfAborted();
  if (MOCK) return uploadVideo(file, signal);
  const fd = new FormData();
  fd.append("file", file);
  fd.append("role", "supporting");
  fd.append("primaryVideoId", primaryVideoId);
  fd.append("description", description);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cleanup = () => signal.removeEventListener("abort", abort);
    const fail = (error: Error) => { cleanup(); reject(error); };
    const abort = () => { xhr.abort(); fail(new DOMException("Upload cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(event.loaded / event.total); };
    xhr.onerror = () => fail(new Error("Upload connection lost. Choose this file again to retry."));
    xhr.onload = () => {
      cleanup();
      let body;
      try { body = JSON.parse(xhr.responseText); } catch { return reject(new Error("The upload returned an invalid response.")); }
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(body.error ?? "Couldn't upload this supporting file."));
      if (!body.videoId) return reject(new Error("The upload did not return an asset ID."));
      resolve(body);
    };
    xhr.send(fd);
  });
}

export async function listSupporting(primaryVideoId: string, signal?: AbortSignal): Promise<SupportingResource[]> {
  if (MOCK) return [];
  return (await json<{ assets: SupportingResource[] }>(await fetch(`/api/projects/${encodeURIComponent(primaryVideoId)}/assets`, { signal }))).assets.filter((a) => a.role === "supporting");
}

export async function describeSupporting(primaryVideoId: string, assetId: string, description: string, signal?: AbortSignal): Promise<void> {
  if (MOCK) return;
  await json(await fetch(`/api/projects/${encodeURIComponent(primaryVideoId)}/assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ description }), signal,
  }));
}
export async function deleteSupporting(primaryVideoId: string, assetId: string, signal?: AbortSignal): Promise<void> {
  if (MOCK) throw new Error("Removing stored media requires the live service.");
  await json(await fetch(`/api/projects/${encodeURIComponent(primaryVideoId)}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE", signal }));
}

export async function analyze(videoId: string, signal?: AbortSignal): Promise<MediaAnalysis> {
  if (MOCK) {
    await sleep(150);
    return mockAnalysis(videoId);
  }
  return (await json<{ analysis: MediaAnalysis }>(await post("/api/analyze", { videoId }, signal))).analysis;
}

export async function getLibrary(): Promise<Library> {
  if (MOCK) return sampleLibrary;
  try {
    const [music, sfx] = await Promise.all([
      fetch("/assets/music/manifest.json").then((r) => (r.ok ? (r.json() as Promise<MusicTrack[]>) : [])),
      fetch("/assets/sfx/manifest.json").then((r) => (r.ok ? (r.json() as Promise<SfxItem[]>) : [])),
    ]);
    return music.length ? { music, sfx } : sampleLibrary;
  } catch {
    return sampleLibrary;
  }
}

/** Copy the style of an inspiration video (fetched from a link, or an uploaded file as fallback). */
export async function reference(input: { url: string } | { file: File }, primaryVideoId: string, signal?: AbortSignal): Promise<ReferenceResult> {
  if (MOCK) {
    await sleep(900);
    return { styleId: "mock-style", profile: null as never, title: "url" in input ? input.url : input.file.name };
  }
  if ("file" in input) {
    const fd = new FormData();
    fd.append("file", input.file);
    fd.append("primaryVideoId", primaryVideoId);
    return json(await fetch("/api/reference", { method: "POST", body: fd, signal }));
  }
  return json(await post("/api/reference", { url: input.url, primaryVideoId }, signal));
}

export async function* generateVariants(req: GenerateRequest, signal?: AbortSignal): AsyncGenerator<VariantsEvent> {
  if (!MOCK) {
    yield* sse<VariantsEvent>(await post("/api/variants", req, signal));
    return;
  }
  const analysis = mockAnalysis(req.videoId);
  const plans = mockAgentPlans(req.count, req.prompt);
  const run = Date.now().toString(36);
  const startedAt = Date.now();
  yield { type: "start", count: req.count, startedAt };
  await sleep(1200); // pretend platform queue
  const order = plans.map((_, i) => ({ i, at: 300 + i * 60 + Math.random() * 300 })).sort((a, b) => a.at - b.at);
  const t0 = performance.now();
  let tokens = 0;
  let tps = 0;
  for (const { i, at } of order) {
    const wait = at - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
    if (signal?.aborted) return;
    const stats = fakeStats();
    tokens += stats.outputTokens;
    tps += stats.tps;
    yield { type: "variant", index: i, editPlan: mockCompile(`${run}-${i}`, plans[i], analysis), stats };
  }
  yield { type: "summary", count: req.count, ok: plans.length, wallMs: Date.now() - startedAt, outputTokens: tokens, avgTps: Math.round(tps / plans.length) };
}

export async function* remix(args: { planId: string; message: string; editPlan?: EditPlan }, signal?: AbortSignal): AsyncGenerator<RemixEvent> {
  if (!MOCK) {
    yield* sse<RemixEvent>(await post("/api/remix", args, signal));
    return;
  }
  await sleep(380 + Math.random() * 250);
  signal?.throwIfAborted();
  const { editPlan, reply } = mockRemix(args.planId, args.message);
  yield { type: "plan", editPlan, stats: fakeStats(380 + Math.round(Math.random() * 300)), reply };
}

export async function getPlan(id: string): Promise<{ editPlan: EditPlan; videoId?: string; projectId?: string; revision?: number; updatedAt?: number }> {
  if (MOCK) return { editPlan: mockPlanById(id) };
  return json(await fetch(`/api/plans/${encodeURIComponent(id)}`));
}

export async function savePlan(id: string, revision: number, editPlan: EditPlan, signal?: AbortSignal): Promise<{ editPlan: EditPlan; revision: number; updatedAt: number }> {
  if (MOCK) throw new Error("Saving to an account requires the live service.");
  return json(await fetch(`/api/plans/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision, editPlan }), signal,
  }));
}

export async function enqueueExport(planId: string, opts: ExportOptions, idempotencyKey: string): Promise<JobView> {
  return (await json<{ job: JobView }>(await post("/api/jobs", { kind: "render", planId, ...opts, idempotencyKey }))).job;
}
export async function getJob(id: string, signal?: AbortSignal): Promise<JobView> {
  return (await json<{ job: JobView }>(await fetch(`/api/jobs/${encodeURIComponent(id)}`, { signal }))).job;
}
export async function cancelJob(id: string): Promise<JobView> {
  return (await json<{ job: JobView }>(await post(`/api/jobs/${encodeURIComponent(id)}/cancel`, {}))).job;
}
export async function getExportResult(id: string, signal?: AbortSignal): Promise<ExportReady> {
  const result = await json<ExportReady>(await fetch(`/api/jobs/${encodeURIComponent(id)}/result`, { signal }));
  if (!result.url) throw new Error("The completed job has no downloadable video yet. Reconnect to check it again.");
  return result;
}
export async function* watchJob(id: string, cursor: number, signal: AbortSignal): AsyncGenerator<JobView> {
  let current = await getJob(id, signal);
  if (current.id !== id) throw new Error("The server returned a different job.");
  yield current;
  if (["succeeded", "failed", "cancelled"].includes(current.state)) return;
  for await (const event of sse<JobView & { type: "job" }>(await fetch(`/api/jobs/${encodeURIComponent(id)}/events?after=${Math.max(cursor, current.revision)}`, { signal }))) {
    if (event.type !== "job") continue;
    current = reconcileJob(current, event);
    yield current;
    if (["succeeded", "failed", "cancelled"].includes(current.state)) return;
  }
  signal.throwIfAborted();
  throw new Error("Progress disconnected. The export may still be running; reconnect to check it.");
}

/** Render the same edit plan that is shown in the preview. */
export type ExportOptions = { editPlan?: EditPlan; resolution?: "720p" | "1080p"; burnCaptions?: boolean };
export async function* exportVideo(planId: string, opts: ExportOptions = {}, signal?: AbortSignal): AsyncGenerator<ExportEvent> {
  if (!MOCK) {
    let ready = false;
    for await (const event of sse<ExportEvent>(await post("/api/export", { planId, ...opts }, signal))) {
      if (event.type === "ready") ready = true;
      if (event.type === "error") throw new Error(event.message);
      yield event;
    }
    if (!ready) throw new Error("The render connection closed before the video was ready. Try again.");
    return;
  }
  for (let p = 0.1; p < 1; p += 0.15) {
    await sleep(220);
    signal?.throwIfAborted();
    yield { type: "progress", progress: p };
  }
  yield { type: "ready", url: mockPlanById(planId).source.src };
}
