import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { FFMPEG, FFPROBE, STT_BIN, round, run, speechConfig, type RunOptions, type SpeechLanguage } from "./util.ts";
import { MediaError } from "./errors.ts";

// ---------------------------------------------------------------- probe
export interface Probe {
  durationSec: number;
  width: number; // display width (rotation applied)
  height: number;
  fps: number;
  vcodec: string;
  pixFmt: string;
  hasAudio: boolean;
  formatName: string;
}

export async function probe(input: string, opts: RunOptions = {}): Promise<Probe> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input], opts);
  const j = JSON.parse(stdout);
  const v = (j.streams ?? []).find((s: any) => s.codec_type === "video");
  if (!v) throw new Error(`no video stream in ${input}`);
  const a = (j.streams ?? []).find((s: any) => s.codec_type === "audio");
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || "30/1").split("/").map(Number);
  let fps = d ? n / d : n;
  if (!isFinite(fps) || fps <= 0 || fps > 240) fps = 30;
  const rot = Math.abs(
    Number(v.tags?.rotate ?? v.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? 0),
  );
  const swap = rot === 90 || rot === 270;
  const durationSec = Number(j.format?.duration ?? v.duration ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !v.width || !v.height) throw new MediaError("INVALID_MEDIA", "This file has no playable video duration or dimensions.");
  return {
    durationSec: round(durationSec),
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    fps: round(fps, 2),
    vcodec: v.codec_name,
    pixFmt: v.pix_fmt,
    hasAudio: !!a,
    formatName: j.format?.format_name ?? "",
  };
}

// ---------------------------------------------------------------- proxy (H.264, <=1080p, faststart)
/** Short side capped at 1080. Remuxes (no re-encode) when the input is already compliant. */
export async function makeProxy(input: string, out: string, p: Probe, opts: RunOptions = {}): Promise<"remux" | "hw" | "x264"> {
  const short = Math.min(p.width, p.height);
  const compliant =
    p.vcodec === "h264" && p.pixFmt === "yuv420p" && short <= 1080 && /mp4|mov/.test(p.formatName) && p.fps <= 60;
  if (compliant) {
    await run(FFMPEG, ["-v", "error", "-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy",
      ...(p.hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : []), "-movflags", "+faststart", out], opts);
    return "remux";
  }
  const scale =
    short > 1080
      ? p.width >= p.height
        ? ["-vf", "scale=-2:1080:flags=bicubic,format=yuv420p"]
        : ["-vf", "scale=1080:-2:flags=bicubic,format=yuv420p"]
      : ["-vf", "format=yuv420p"];
  const fpsArgs = p.fps > 60 ? ["-r", "60"] : [];
  const common = ["-map", "0:v:0", "-map", "0:a:0?", ...scale, ...fpsArgs,
    ...(p.hasAudio ? ["-c:a", "aac", "-b:a", "160k", "-ac", "2"] : []), "-movflags", "+faststart", out];
  // The hardware H.264 encoder is ~5-10x faster than software; fall back if unavailable.
  const vt = await run(FFMPEG, ["-v", "error", "-y", "-i", input, "-c:v", "h264_videotoolbox", "-b:v", "8M",
    "-profile:v", "high", ...common], { ...opts, allowFail: true });
  if (vt.code === 0) return "hw";
  await run(FFMPEG, ["-v", "error", "-y", "-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", "4", ...common], opts);
  return "x264";
}

// ---------------------------------------------------------------- transcript (local speech-to-text)
export interface WordT { text: string; start: number; end: number; confidence?: number }

const NON_SPEECH = /^[\[(♪*].*[\])♪*]$|^\s*$/;

/** Word-level transcript. Returns [] if no audio / no speech (music-only gameplay etc.). */
export async function transcribe(input: string, workDir: string, hasAudio: boolean, opts: RunOptions & { language?: SpeechLanguage; onWarning?: (message: string) => void } = {}): Promise<WordT[]> {
  if (!hasAudio) return [];
  const config = speechConfig(opts.language);
  const wav = path.join(workDir, "audio16k.wav");
  const base = path.join(workDir, "transcript");
  try {
    await run(FFMPEG, ["-v", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], opts);
    await rm(base + ".json", { force: true });
    const r = await run(STT_BIN, ["-m", config.model, "-f", wav, "-ml", "1", "-sow", "-ojf", "-of", base, "-np",
      "-t", String(Math.min(4, availableParallelism())), "-l", config.language, "-sns"], { ...opts, allowFail: true });
    if (r.code !== 0 || !existsSync(base + ".json")) throw new MediaError("SPEECH_FAILED", "Speech analysis failed. Check the local speech tool and model, then retry.");
    const transcript = JSON.parse(await readFile(base + ".json", "utf8"));
    const words = parseTranscript(transcript, config.language);
    if (hasUntimedSpeech(transcript)) opts.onWarning?.("Some recognized speech had no valid word timing and was excluded from captions. Review captions against the original audio.");
    return words;
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError("SPEECH_FAILED", "Speech analysis could not run. Check the local speech tool and model, then retry.");
  } finally {
    await rm(wav, { force: true });
  }
}

export function hasUntimedSpeech(j: any): boolean {
  return (j.transcription ?? []).some((segment: any) => {
    const text = String(segment.text ?? "").trim();
    const start = Number(segment.offsets?.from), end = Number(segment.offsets?.to);
    return !NON_SPEECH.test(text) && /[\p{L}\p{N}]/u.test(text) && (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start);
  });
}

export function parseTranscript(j: any, language: SpeechLanguage = "en"): WordT[] {
  if (language !== "en" && j.model?.multilingual !== true) throw new MediaError("SPEECH_MODEL_MISSING", "The configured model is not multilingual. Configure a multilingual speech model and retry.");
  if (j.params?.translate === true) throw new MediaError("SPEECH_FAILED", "Speech analysis returned a translation. Retry with original-language transcription enabled.");
  const words: WordT[] = [];
  for (const seg of j.transcription ?? []) {
    const text = String(seg.text ?? "").trim();
    const start = Number(seg.offsets?.from) / 1000;
    const end = Number(seg.offsets?.to) / 1000;
    if (NON_SPEECH.test(text) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || Number(seg.no_speech_prob ?? 0) > 0.7) continue;
    const probabilities = (seg.tokens ?? []).filter((t: any) => !String(t.text ?? "").startsWith("[_")).map((t: any) => Number(t.p)).filter((p: number) => Number.isFinite(p) && p >= 0 && p <= 1);
    const confidence = probabilities.length ? probabilities.reduce((sum: number, p: number) => sum + p, 0) / probabilities.length : undefined;
    // -ml 1 -sow puts one word per segment, but punctuation sometimes lands alone: glue it on.
    if (/^[.,!?;:'"%।…。！？、，-]+$/.test(text) && words.length) {
      words[words.length - 1].text += text;
      words[words.length - 1].end = round(end);
      continue;
    }
    // The STT model often stretches a word over preceding silence (e.g. "Hi." 0.0→7.0). End times are
    // reliable; cap the duration by word length and anchor at the end.
    const maxDur = Math.max(0.35, 0.09 * text.length + 0.2);
    words.push({ text, start: round(Math.max(start, end - maxDur)), end: round(end), ...(confidence === undefined ? {} : { confidence }) });
  }
  return words;
}

/** Heuristic: the STT model hallucinates a few words on music; require real density. */
export function looksLikeSpeech(words: WordT[], durationSec: number, loudness: { db: number }[] = []): boolean {
  if (!words.length || (loudness.length > 0 && loudness.every((l) => l.db < -55))) return false;
  const spoken = words.reduce((s, w) => s + (w.end - w.start), 0);
  // A short real utterance is valid. Low-confidence isolated guesses over music are not sufficient.
  if (words.length < 4) {
    const reliable = words.every((w) => w.confidence !== undefined && w.confidence >= 0.65);
    return reliable && spoken >= 0.12 && (spoken / Math.max(durationSec, 1) > 0.04 || words.length / Math.max(durationSec, 1) > 0.2);
  }
  if (words.every((w) => w.confidence !== undefined && w.confidence < 0.35)) return false;
  return spoken / Math.max(durationSec, 1) > 0.08 || words.length / Math.max(durationSec, 1) > 0.4;
}

// ---------------------------------------------------------------- scenes
/** Scene cut times via ffmpeg scene score (on a downscaled decode for speed). */
export async function detectCuts(input: string, threshold = 0.3, durationSec = 0, opts: RunOptions = {}): Promise<number[]> {
  // Long clips: split into parallel chunks (decode is the bottleneck and the filter chain is serial).
  const chunks = durationSec > 20 ? Math.min(4, Math.max(2, Math.ceil(durationSec / 30)), availableParallelism()) : 1;
  const len = durationSec / chunks;
  const parts = await Promise.all(
    Array.from({ length: chunks }, async (_, i) => {
      const seek = chunks > 1 ? ["-ss", String(i * len), "-t", String(len + 0.05)] : [];
      const common = [...seek, "-i", input, "-an", "-sn", "-vf", `scale=160:-2,select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"];
      let r = await run(FFMPEG, ["-hide_banner", "-hwaccel", "videotoolbox", ...common], { ...opts, allowFail: true });
      if (r.code !== 0) r = await run(FFMPEG, ["-hide_banner", "-threads", "2", ...common], opts);
      const out: number[] = [];
      // with input seeking, pts restart at 0 for each chunk
      for (const m of r.stderr.matchAll(/pts_time:([\d.]+)/g)) {
        const t = Number(m[1]) + (chunks > 1 ? i * len : 0);
        if (chunks === 1 || Number(m[1]) > 0.05) out.push(t);
      }
      return out;
    }),
  );
  return parts.flat().sort((a, b) => a - b);
}

export function cutsToScenes(cuts: number[], durationSec: number, minShot = 0.4) {
  const bounds = [0];
  for (const c of cuts.sort((a, b) => a - b)) if (c - bounds[bounds.length - 1] >= minShot && durationSec - c >= minShot) bounds.push(c);
  bounds.push(durationSec);
  const scenes: { start: number; end: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) scenes.push({ start: round(bounds[i]), end: round(bounds[i + 1]) });
  return scenes;
}

// ---------------------------------------------------------------- loudness (~4Hz)
export async function loudnessEnvelope(input: string, hasAudio: boolean, durationSec: number, opts: RunOptions = {}) {
  if (!hasAudio) return [];
  // 8kHz mono, 2000-sample windows -> 4 windows/sec; astats RMS per window.
  const r = await run(FFMPEG, ["-hide_banner", "-i", input, "-vn", "-af",
    "aresample=8000,pan=mono|c0=c0+c1,asetnsamples=n=2000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
    "-f", "null", "-"], { ...opts, allowFail: true });
  let text = r.stderr;
  if (!/RMS_level/.test(text)) {
    // mono sources: pan with c1 fails; retry without pan
    const r2 = await run(FFMPEG, ["-hide_banner", "-i", input, "-vn", "-af",
      "aresample=8000,asetnsamples=n=2000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
      "-f", "null", "-"], opts);
    text = r2.stderr;
  }
  const out: { t: number; db: number }[] = [];
  let t: number | null = null;
  for (const line of text.split("\n")) {
    const pm = line.match(/pts_time:([\d.]+)/);
    if (pm) t = Number(pm[1]);
    const lm = line.match(/RMS_level=(-?[\d.]+|-inf)/);
    if (lm && t !== null) {
      const db = lm[1] === "-inf" ? -90 : Math.max(-90, Number(lm[1]));
      if (t <= durationSec) out.push({ t: round(t, 2), db: round(db, 1) });
      t = null;
    }
  }
  return out;
}

// ---------------------------------------------------------------- frames
/** Times: every ~2s + scene starts, deduped, capped at `max` (evenly thinned). */
export function pickFrameTimes(durationSec: number, sceneStarts: number[], max = 16, every = 2): number[] {
  max = Math.min(32, Math.max(0, Math.floor(max)));
  if (!max || durationSec <= 0) return [];
  const end = Math.max(0, durationSec - 0.1);
  const grid: number[] = [];
  for (let t = Math.min(0.5, end); t < end; t += every) grid.push(t);
  const scenePts = [...new Set(sceneStarts.filter((s) => Number.isFinite(s) && s >= 0 && s < durationSec).map((s) => Math.min(end, s + 0.15)))].sort((a, b) => a - b); // just after the cut
  // Scene starts win over nearby grid points.
  const all = [...scenePts, ...grid.filter((g) => !scenePts.some((s) => Math.abs(s - g) < 0.75))].sort((a, b) => a - b);
  const dedup: number[] = [];
  for (const t of all) if (!dedup.length || t - dedup[dedup.length - 1] >= 0.75) dedup.push(t);
  if (dedup.length <= max) return dedup.map((t) => round(t, 2));
  // Keep scene starts preferentially, then thin the rest evenly.
  const sceneSet = dedup.filter((t) => scenePts.some((s) => Math.abs(s - t) < 0.01));
  const evenly = (points: number[], count: number) => Array.from({ length: count }, (_, i) => points[count === 1 ? 0 : Math.round(i * (points.length - 1) / (count - 1))]);
  if (sceneSet.length >= max) return evenly(sceneSet, max).map((t) => round(t, 2));
  const result = [...sceneSet];
  const remaining = dedup.filter((t) => !sceneSet.includes(t));
  for (const t of evenly(remaining, Math.min(max - result.length, remaining.length))) {
    result.push(t);
  }
  return result.sort((a, b) => a - b).slice(0, max).map((t) => round(t, 2));
}

export async function extractFrames(input: string, outDir: string, times: number[], longSide = 512, opts: RunOptions = {}) {
  await mkdir(outDir, { recursive: true });
  const scale = `scale='if(gte(iw,ih),${longSide},-2)':'if(gte(iw,ih),-2,${longSide})'`;
  const results: ({ t: number; name: string } | null)[] = [];
  // Limit concurrent decoders; the parent analysis already runs other media steps in parallel.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, times.length) }, async () => {
    while (next < times.length) {
      const index = next++;
      const t = times[index];
      const name = `f_${t.toFixed(2).replace(".", "_")}.jpg`;
      const r = await run(FFMPEG, ["-v", "error", "-y", "-ss", String(t), "-i", input, "-frames:v", "1",
        "-vf", scale, "-q:v", "4", path.join(outDir, name)], { ...opts, allowFail: true });
      results[index] = r.code === 0 && existsSync(path.join(outDir, name)) ? { t, name } : null;
    }
  }));
  const frames = results.filter((x): x is { t: number; name: string } => !!x);
  if (!frames.length) throw new MediaError("ANALYSIS_FAILED", "No preview frames could be decoded. Try converting this video to MP4.");
  return frames;
}
