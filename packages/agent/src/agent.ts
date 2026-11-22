import {
  AgentPlan,
  CaptionDesign,
  BrollSelection,
  checkEditQuality,
  StyleProfile,
  compileEditPlan,
  type EditPlan,
  type Library,
  type MediaAnalysis,
  type SupportingFootage,
} from "@unfold/core";
import { agentConfigFromEnv, extractJson, streamChat, type AgentConfig, type StreamStats } from "./client";
import { ADAPTIVE_DIRECTION, VARIANT_DIRECTIONS, planRequest, remixRequest, styleRequest } from "./prompt";

export type FrameLoader = (url: string) => Promise<string>; // web path → data URL (base64 jpeg)

export type PlanResult = { agentPlan: AgentPlan; editPlan: EditPlan; stats: StreamStats; raw: string };

export type AgentContext = {
  analysis: MediaAnalysis;
  library: Library;
  loadFrame: FrameLoader;
  config?: AgentConfig;
  maxFrames?: number;
  supporting?: SupportingFootage[];
};

async function frameInputs(ctx: AgentContext): Promise<{ analysis: MediaAnalysis; urls: string[] }> {
  const max = ctx.maxFrames ?? 8;
  const frames = ctx.analysis.frames;
  const step = Math.max(1, Math.ceil(frames.length / max));
  const picked = frames.filter((_, i) => i % step === 0).slice(0, max);
  const out = await Promise.all(picked.map(async (frame) => ({ frame, url: await ctx.loadFrame(frame.url).catch(() => null) })));
  const loaded = out.filter((item): item is { frame: MediaAnalysis["frames"][number]; url: string } => !!item.url);
  return { analysis: { ...ctx.analysis, frames: loaded.map((item) => item.frame) }, urls: loaded.map((item) => item.url) };
}

/** Repair a model cut inside a known word without changing the chosen story. */
function speechRange(srcStart: number, srcEnd: number, analysis: MediaAnalysis) {
  if (!analysis.hasSpeech) return { srcStart, srcEnd };
  const first = analysis.words.find((w) => w.start < srcStart && w.end > srcStart);
  const last = analysis.words.find((w) => w.start < srcEnd && w.end > srcEnd);
  if (first) srcStart = srcStart - first.start <= first.end - srcStart ? first.start : first.end;
  if (last) srcEnd = Math.min(analysis.durationSec, last.end);
  return { srcStart, srcEnd };
}

/** Make a model reply valid: fill defaults, clamp ranges, drop unknown asset ids. */
export function normalizePlan(raw: unknown, ctx: { analysis: MediaAnalysis; library: Library; supporting?: SupportingFootage[] }): AgentPlan {
  const r = (raw ?? {}) as any;
  const dur = ctx.analysis.durationSec;
  const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
  const musicIds = new Set(ctx.library.music.map((m) => m.id));
  const sfxIds = new Set(ctx.library.sfx.map((s) => s.id));
  const segs = Array.isArray(r.segments) ? r.segments : [];
  const design = CaptionDesign.safeParse(r.captions?.design);
  const validSourceTime = (time: unknown): time is number => typeof time === "number" && Number.isFinite(time) && time >= 0 && time < dur;
  const normalizedSegments = segs.map((s: any, originalIndex: number) => ({
    ...speechRange(clamp(s?.srcStart, 0, dur, 0), clamp(s?.srcEnd, 0, dur, dur), ctx.analysis),
    speed: clamp(s?.speed, 0.5, 2, 1), originalIndex,
  })).filter((s: any) => s.srcEnd - s.srcStart >= 0.3);
  const segmentIndices = new Map<number, number>(normalizedSegments.map((s: any, i: number) => [s.originalIndex, i]));
  const candidate = {
    ...r,
    style: ["gaming-montage", "podcast-clip", "storytime", "chaos", "custom"].includes(r.style) ? r.style : "custom",
    title: typeof r.title === "string" && r.title ? r.title.slice(0, 32) : "Unfold edit",
    rationale: typeof r.rationale === "string" ? r.rationale : "",
    aspect: ["9:16", "1:1", "16:9"].includes(r.aspect) ? r.aspect : "9:16",
    hookText: typeof r.hookText === "string" && r.hookText.trim() ? r.hookText.trim() : null,
    segments: normalizedSegments.map(({ originalIndex, ...s }: any) => s),
    captions: {
      enabled: ctx.analysis.hasSpeech && r.captions?.enabled !== false,
      preset: ["bold-pop", "clean-pop", "meme", "story", "karaoke"].includes(r.captions?.preset) ? r.captions.preset : "clean-pop",
      wordsPerChunk: Math.round(clamp(r.captions?.wordsPerChunk, 1, 5, 4)),
      position: ["upper", "center", "lower"].includes(r.captions?.position) ? r.captions.position : "lower",
      uppercase: r.captions?.uppercase === true,
      highlightColor: /^#[0-9a-f]{6}$/i.test(r.captions?.highlightColor ?? "") ? r.captions.highlightColor : "#FFE14D",
      emphasisWords: Array.isArray(r.captions?.emphasisWords) ? r.captions.emphasisWords.filter((w: unknown) => typeof w === "string").slice(0, 12) : [],
      ...(design.success ? { design: design.data } : {}),
    },
    music:
      r.music && musicIds.has(r.music.trackId)
        ? {
            trackId: r.music.trackId,
            volume: clamp(r.music.volume, 0, 1, ctx.analysis.hasSpeech ? 0.12 : 0.22),
            alignDropToSrc: validSourceTime(r.music.alignDropToSrc) ? r.music.alignDropToSrc : null,
            snapCutsToBeats: r.music.snapCutsToBeats === true,
          }
        : null,
    transitions: (Array.isArray(r.transitions) ? r.transitions : []).flatMap((t: any) => {
      const afterSegment = Number.isInteger(t?.afterSegment) ? segmentIndices.get(t.afterSegment) : undefined;
      return afterSegment === undefined ? [] : [{ ...t, afterSegment }];
    }),
    zooms: (Array.isArray(r.zooms) ? r.zooms : [])
      .filter((z: any) => validSourceTime(z?.srcTime))
      .map((z: any) => ({ srcTime: z.srcTime, kind: z.kind === "punch" ? "punch" : "slow-push", scale: clamp(z.scale, 1, 1.8, 1.08) })),
    sfx: (Array.isArray(r.sfx) ? r.sfx : [])
      .filter((s: any) => sfxIds.has(s?.sfxId) && validSourceTime(s?.srcTime))
      .map((s: any) => ({ srcTime: s.srcTime, sfxId: s.sfxId, volume: clamp(s.volume, 0, 1, 0.35) })),
    overlays: (Array.isArray(r.overlays) ? r.overlays : []).filter((o: any) => typeof o?.text === "string" && validSourceTime(o?.srcTime)),
    broll: (Array.isArray(r.broll) ? r.broll.slice(0, 12) : []).flatMap((shot: unknown) => {
      const parsed = BrollSelection.safeParse(shot);
      if (!parsed.success) return [];
      const s = parsed.data;
      const segmentIndex = segmentIndices.get(s.segmentIndex);
      if (segmentIndex === undefined) return [];
      const asset = ctx.supporting?.find((a) => a.analysis.videoId === s.assetId)?.analysis;
      if (!asset || s.srcEnd <= s.srcStart || s.srcEnd > asset.durationSec + 0.000001 || !validSourceTime(s.atSrcTime)) return [];
      if (s.evidenceFrameTime < s.srcStart || s.evidenceFrameTime >= s.srcEnd || !asset.frames.some((f) => Math.abs(f.t - s.evidenceFrameTime) < 0.02)) return [];
      return [{ ...s, srcEnd: Math.min(s.srcEnd, asset.durationSec), segmentIndex }];
    }),
  };
  if (candidate.segments.length === 0) candidate.segments = [{ srcStart: 0, srcEnd: dur, speed: 1 }];
  const parsed = AgentPlan.safeParse(candidate);
  if (parsed.success) return parsed.data;
  // Last resort: keep only what validates.
  return AgentPlan.parse({ ...candidate, transitions: [], zooms: [], overlays: [] });
}

let planCounter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(planCounter++).toString(36)}`;

function toResult(text: string, stats: StreamStats, ctx: AgentContext): PlanResult {
  const agentPlan = normalizePlan(extractJson(text), ctx);
  const editPlan = compileEditPlan(agentPlan, ctx.analysis, ctx.library, {
    id: newId("plan"),
    stats: { planMs: stats.genMs, outputTokens: stats.outputTokens, tps: stats.tps, model: stats.model },
    supporting: ctx.supporting,
  });
  const quality = checkEditQuality(editPlan, ctx.analysis);
  const requested = (extractJson(text) as { broll?: unknown[] })?.broll;
  if (Array.isArray(requested) && requested.length > (editPlan.broll?.length ?? 0)) quality.warnings.push("Removed supporting shots with unavailable footage, missing frame evidence, overlap or a cut-away narration anchor.");
  if (!agentPlan.rationale.trim()) quality.warnings.push("The planner did not explain its editorial choice.");
  editPlan.quality = quality;
  if (!quality.passed) throw new Error(`Edit quality check failed: ${quality.errors.join(" ")}`);
  return { agentPlan, editPlan, stats, raw: text };
}

async function supportingInputs(ctx: AgentContext) {
  return Promise.all((ctx.supporting ?? []).slice(0, 4).map(async (footage) => {
    const frames = await frameInputs({ ...ctx, analysis: footage.analysis, maxFrames: 2 });
    return { footage: { ...footage, analysis: frames.analysis }, urls: frames.urls };
  }));
}

/** One edit plan from the creator's brief. */
export async function generatePlan(
  ctx: AgentContext,
  brief: string,
  opts: { direction?: string; style?: StyleProfile | null; aspect?: string; onDelta?: (t: string) => void; signal?: AbortSignal } = {},
): Promise<PlanResult> {
  const cfg = ctx.config ?? agentConfigFromEnv();
  const frames = await frameInputs(ctx);
  const supporting = await supportingInputs(ctx);
  const messages = planRequest({ analysis: frames.analysis, library: ctx.library, frameDataUrls: frames.urls, supporting, brief, ...opts });
  const { text, stats } = await streamChat(messages, cfg, { onDelta: opts.onDelta }, { signal: opts.signal });
  return toResult(text, stats, { ...ctx, supporting: supporting.map((s) => s.footage) });
}

/**
 * N different variants in parallel. Yields each as soon as it lands (the UI grid fills live).
 * All requests share the same prefix so Cerebras prompt caching kicks in.
 */
export async function* generateVariants(
  ctx: AgentContext,
  brief: string,
  opts: { count?: number; style?: StyleProfile | null; aspect?: string; signal?: AbortSignal } = {},
): AsyncGenerator<{ index: number; direction: string; result?: PlanResult; error?: string }> {
  const cfg = ctx.config ?? agentConfigFromEnv();
  const frames = await frameInputs(ctx);
  const supporting = await supportingInputs(ctx);
  const count = Math.min(opts.count ?? 9, VARIANT_DIRECTIONS.length);
  const pending = new Map<number, Promise<{ index: number; direction: string; result?: PlanResult; error?: string }>>();
  for (let i = 0; i < count; i++) {
    const direction = count === 1 ? ADAPTIVE_DIRECTION : VARIANT_DIRECTIONS[i];
    const messages = planRequest({ analysis: frames.analysis, library: ctx.library, frameDataUrls: frames.urls, supporting, brief, direction, style: opts.style, aspect: opts.aspect });
    pending.set(
      i,
      streamChat(messages, cfg, {}, { signal: opts.signal })
        .then(({ text, stats }) => ({ index: i, direction, result: toResult(text, stats, { ...ctx, supporting: supporting.map((s) => s.footage) }) }))
        .catch((e: unknown) => ({ index: i, direction, error: e instanceof Error ? e.message : String(e) })),
    );
  }
  while (pending.size) {
    const done = await Promise.race(pending.values());
    pending.delete(done.index);
    yield done;
  }
}

/** Apply a chat instruction ("faster pacing", "less meme sounds") to an existing plan. */
export async function remixPlan(
  ctx: AgentContext,
  current: AgentPlan,
  message: string,
  opts: { onDelta?: (t: string) => void; signal?: AbortSignal; currentEdit?: EditPlan } = {},
): Promise<PlanResult> {
  const cfg = ctx.config ?? agentConfigFromEnv();
  const frames = await frameInputs(ctx);
  const supporting = await supportingInputs(ctx);
  const messages = remixRequest({ analysis: frames.analysis, library: ctx.library, frameDataUrls: frames.urls, supporting, current, currentEdit: opts.currentEdit, message });
  const { text, stats } = await streamChat(messages, cfg, { onDelta: opts.onDelta }, { signal: opts.signal });
  return toResult(text, stats, { ...ctx, supporting: supporting.map((s) => s.footage) });
}

/** Turn an analysed inspiration video into a StyleProfile. */
export async function analyzeStyle(
  reference: MediaAnalysis,
  loadFrame: FrameLoader,
  stats: { cutsPerMinute: number; avgShotSec: number },
  config?: AgentConfig,
): Promise<{ profile: StyleProfile; stats: StreamStats }> {
  const cfg = config ?? agentConfigFromEnv();
  const frames = await frameInputs({ analysis: reference, library: { music: [], sfx: [] }, loadFrame, maxFrames: 8 });
  const { text, stats: s } = await streamChat(styleRequest(frames.analysis, frames.urls, stats), cfg);
  const raw = extractJson(text) as any;
  const profile = StyleProfile.parse({
    summary: String(raw.summary ?? "Reference visual style"),
    cutsPerMinute: Number(raw.cutsPerMinute ?? stats.cutsPerMinute),
    avgShotSec: Number(raw.avgShotSec ?? stats.avgShotSec),
    captions: {
      preset: ["bold-pop", "clean-pop", "meme", "story", "karaoke"].includes(raw.captions?.preset) ? raw.captions.preset : "clean-pop",
      wordsPerChunk: Math.min(5, Math.max(1, Math.round(Number(raw.captions?.wordsPerChunk ?? 4)))),
      position: ["upper", "center", "lower"].includes(raw.captions?.position) ? raw.captions.position : "lower",
      uppercase: raw.captions?.uppercase === true,
      highlightColor: /^#[0-9a-f]{6}$/i.test(raw.captions?.highlightColor ?? "") ? raw.captions.highlightColor : "#FFE14D",
    },
    transitions: (Array.isArray(raw.transitions) ? raw.transitions : []).filter((t: string) =>
      ["cut", "whip", "zoom-punch", "flash", "shake", "glitch", "slide"].includes(t),
    ),
    zoomIntensity: Math.min(1, Math.max(0, Number(raw.zoomIntensity ?? 0))),
    // Audio is not sent to this analysis call; these fields remain neutral for compatibility.
    sfxDensityPerMin: 0,
    musicEnergy: 0,
    musicMoods: [],
  });
  return { profile, stats: s };
}
