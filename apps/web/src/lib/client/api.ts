/**
 * Typed client for Unfold's API (routes in app/api, owned by the main session).
 *
 * Live by default. Set NEXT_PUBLIC_UNFOLD_API=mock to use sample fixtures + the real compiler instead.
 *   POST /api/upload     multipart {file}                                  → { videoId }
 *   POST /api/analyze    {videoId}                                         → { analysis }   (10–30s; "sample" = demo)
 *   POST /api/reference  {url} | multipart {file}                          → { styleId, profile, cutStats, title, stats }
 *   POST /api/variants   {videoId, prompt, styleId?, aspect?, count}       → SSE start | variant | variant-error | summary | done
 *   POST /api/remix      {planId, message}                                 → SSE delta | plan | done
 *   POST /api/export     {planId, resolution?, burnCaptions?}              → SSE progress | ready | done
 *   GET  /api/plans/:id                                                    → { editPlan, agentPlan, videoId }
 *   GET  /assets/{music,sfx}/manifest.json                                 → MusicTrack[] / SfxItem[]
 */
import { sampleLibrary, type EditPlan, type Library, type MediaAnalysis, type MusicTrack, type SfxItem } from "@unfold/core";
import { fakeStats, mockAgentPlans, mockAnalysis, mockCompile, mockPlanById, mockRegisterUpload, mockRemix } from "./mock";
import type { ExportEvent, GenerateRequest, ReferenceResult, RemixEvent, VariantsEvent } from "./types";

export const MOCK = process.env.NEXT_PUBLIC_UNFOLD_API === "mock";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body && (body.error as string)) || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
const post = (url: string, body: unknown, signal?: AbortSignal) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });

/** Parse a named-event SSE stream into {type, ...data}. Ignores ping, stops at done. */
async function* sse<T extends { type: string }>(res: Response): AsyncGenerator<T> {
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error((body && body.error) || `${res.status} ${res.statusText}`);
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
export async function reference(input: { url: string } | { file: File }, signal?: AbortSignal): Promise<ReferenceResult> {
  if (MOCK) {
    await sleep(900);
    return { styleId: "mock-style", profile: null as never, title: "url" in input ? input.url : input.file.name };
  }
  if ("file" in input) {
    const fd = new FormData();
    fd.append("file", input.file);
    return json(await fetch("/api/reference", { method: "POST", body: fd, signal }));
  }
  return json(await post("/api/reference", { url: input.url }, signal));
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

export async function* remix(args: { planId: string; message: string }, signal?: AbortSignal): AsyncGenerator<RemixEvent> {
  if (!MOCK) {
    yield* sse<RemixEvent>(await post("/api/remix", args, signal));
    return;
  }
  await sleep(380 + Math.random() * 250);
  signal?.throwIfAborted();
  const { editPlan, reply } = mockRemix(args.planId, args.message);
  yield { type: "plan", editPlan, stats: fakeStats(380 + Math.round(Math.random() * 300)), reply };
}

export async function getPlan(id: string): Promise<{ editPlan: EditPlan; videoId?: string }> {
  if (MOCK) return { editPlan: mockPlanById(id) };
  return json(await fetch(`/api/plans/${encodeURIComponent(id)}`));
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
