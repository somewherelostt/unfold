import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { FFMPEG, FFPROBE, STT_BIN, STT_MODEL, round, run } from "./util.ts";

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

export async function probe(input: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input]);
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
export async function makeProxy(input: string, out: string, p: Probe): Promise<"remux" | "hw" | "x264"> {
  const short = Math.min(p.width, p.height);
  const compliant =
    p.vcodec === "h264" && p.pixFmt === "yuv420p" && short <= 1080 && /mp4|mov/.test(p.formatName) && p.fps <= 60;
  if (compliant) {
    await run(FFMPEG, ["-v", "error", "-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy",
      ...(p.hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : []), "-movflags", "+faststart", out]);
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
    "-profile:v", "high", ...common], { allowFail: true });
  if (vt.code === 0) return "hw";
  await run(FFMPEG, ["-v", "error", "-y", "-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", ...common]);
  return "x264";
}

// ---------------------------------------------------------------- transcript (local speech-to-text)
export interface WordT { text: string; start: number; end: number }

const NON_SPEECH = /^[\[(♪*].*[\])♪*]$|^\s*$/;

/** Word-level transcript. Returns [] if no audio / no speech (music-only gameplay etc.). */
export async function transcribe(input: string, workDir: string, hasAudio: boolean): Promise<WordT[]> {
  if (!hasAudio) return [];
  if (!existsSync(STT_MODEL)) {
    console.warn(`[media] speech-to-text model missing at ${STT_MODEL}; skipping transcript`);
    return [];
  }
  const wav = path.join(workDir, "audio16k.wav");
  const base = path.join(workDir, "transcript");
  await run(FFMPEG, ["-v", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  const r = await run(STT_BIN, ["-m", STT_MODEL, "-f", wav, "-ml", "1", "-sow", "-oj", "-of", base, "-np",
    "-t", "8", "-l", "en", "-sns"], { allowFail: true });
  await rm(wav, { force: true });
  if (r.code !== 0 || !existsSync(base + ".json")) {
    console.warn(`[media] speech-to-text failed (${r.code}); continuing without transcript\n${r.stderr.slice(-500)}`);
    return [];
  }
  const j = JSON.parse(await readFile(base + ".json", "utf8"));
  const words: WordT[] = [];
  for (const seg of j.transcription ?? []) {
    const text = String(seg.text ?? "").trim();
    const start = seg.offsets.from / 1000;
    const end = seg.offsets.to / 1000;
    if (NON_SPEECH.test(text) || end <= start) continue;
    // -ml 1 -sow puts one word per segment, but punctuation sometimes lands alone: glue it on.
    if (/^[.,!?;:'"%-]+$/.test(text) && words.length) {
      words[words.length - 1].text += text;
      words[words.length - 1].end = round(end);
      continue;
    }
    // The STT model often stretches a word over preceding silence (e.g. "Hi." 0.0→7.0). End times are
    // reliable; cap the duration by word length and anchor at the end.
    const maxDur = Math.max(0.35, 0.09 * text.length + 0.2);
    words.push({ text, start: round(Math.max(start, end - maxDur)), end: round(end) });
  }
  return words;
}

/** Heuristic: the STT model hallucinates a few words on music; require real density. */
export function looksLikeSpeech(words: WordT[], durationSec: number): boolean {
  if (words.length < 4) return false;
  const spoken = words.reduce((s, w) => s + (w.end - w.start), 0);
  return spoken / Math.max(durationSec, 1) > 0.08 || words.length / Math.max(durationSec, 1) > 0.4;
}

// ---------------------------------------------------------------- scenes
/** Scene cut times via ffmpeg scene score (on a downscaled decode for speed). */
export async function detectCuts(input: string, threshold = 0.3, durationSec = 0): Promise<number[]> {
  // Long clips: split into parallel chunks (decode is the bottleneck and the filter chain is serial).
  const chunks = durationSec > 20 ? Math.min(8, Math.max(2, Math.ceil(durationSec / 15)), availableParallelism()) : 1;
  const len = durationSec / chunks;
  const parts = await Promise.all(
    Array.from({ length: chunks }, async (_, i) => {
      const seek = chunks > 1 ? ["-ss", String(i * len), "-t", String(len + 0.05)] : [];
      const r = await run(FFMPEG, ["-hide_banner", "-hwaccel", "videotoolbox", ...seek, "-i", input, "-an", "-sn",
        "-vf", `scale=160:-2,select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"], { allowFail: true });
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
export async function loudnessEnvelope(input: string, hasAudio: boolean, durationSec: number) {
  if (!hasAudio) return [];
  // 8kHz mono, 2000-sample windows -> 4 windows/sec; astats RMS per window.
  const r = await run(FFMPEG, ["-hide_banner", "-i", input, "-vn", "-af",
    "aresample=8000,pan=mono|c0=c0+c1,asetnsamples=n=2000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
    "-f", "null", "-"], { allowFail: true });
  let text = r.stderr;
  if (!/RMS_level/.test(text)) {
    // mono sources: pan with c1 fails; retry without pan
    const r2 = await run(FFMPEG, ["-hide_banner", "-i", input, "-vn", "-af",
      "aresample=8000,asetnsamples=n=2000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
      "-f", "null", "-"], { allowFail: true });
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
  const end = Math.max(0, durationSec - 0.1);
  const grid: number[] = [];
  for (let t = Math.min(0.5, end); t < end; t += every) grid.push(t);
  const scenePts = sceneStarts.map((s) => Math.min(end, s + 0.15)); // just after the cut, not on the blend
  // Scene starts win over nearby grid points.
  const all = [...scenePts, ...grid.filter((g) => !scenePts.some((s) => Math.abs(s - g) < 0.75))].sort((a, b) => a - b);
  const dedup: number[] = [];
  for (const t of all) if (!dedup.length || t - dedup[dedup.length - 1] >= 0.75) dedup.push(t);
  if (dedup.length <= max) return dedup.map((t) => round(t, 2));
  // Keep scene starts preferentially, then thin the rest evenly.
  const keep = new Set<number>();
  const sceneSet = dedup.filter((t) => scenePts.some((s) => Math.abs(s - t) < 0.01));
  const step = dedup.length / max;
  for (let i = 0; i < max; i++) keep.add(dedup[Math.floor(i * step)]);
  const result = [...keep];
  for (const s of sceneSet) {
    if (result.length >= max) break;
    if (!keep.has(s)) result.push(s);
  }
  return result.sort((a, b) => a - b).slice(0, max).map((t) => round(t, 2));
}

export async function extractFrames(input: string, outDir: string, times: number[], longSide = 512) {
  await mkdir(outDir, { recursive: true });
  const scale = `scale='if(gte(iw,ih),${longSide},-2)':'if(gte(iw,ih),-2,${longSide})'`;
  const results = await Promise.all(
    times.map(async (t) => {
      const name = `f_${t.toFixed(2).replace(".", "_")}.jpg`;
      const r = await run(FFMPEG, ["-v", "error", "-y", "-ss", String(t), "-i", input, "-frames:v", "1",
        "-vf", scale, "-q:v", "4", path.join(outDir, name)], { allowFail: true });
      return r.code === 0 && existsSync(path.join(outDir, name)) ? { t, name } : null;
    }),
  );
  return results.filter((x): x is { t: number; name: string } => !!x);
}
