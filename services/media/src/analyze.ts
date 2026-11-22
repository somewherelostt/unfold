import { copyFile, link, mkdir, writeFile, readFile, stat, rename, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { MediaAnalysis } from "../../../packages/core/src/schema.ts";
import {
  cutsToScenes, detectCuts, extractFrames, looksLikeSpeech, loudnessEnvelope, makeProxy, pickFrameTimes, probe, transcribe,
} from "./steps.ts";
import { MEDIA_DIR, MEDIA_URL_PREFIX, newVideoId, timed, speechConfig, type SpeechLanguage } from "./util.ts";
import { MediaError } from "./errors.ts";

export interface AnalyzeOptions {
  videoId?: string;
  /** Skip the proxy transcode (e.g. for reference videos we never render). Default false. */
  skipProxy?: boolean;
  sceneThreshold?: number;
  maxFrames?: number;
  /** Override output root (default <repo>/data/media). */
  mediaDir?: string;
  urlPrefix?: string;
  /** Original-language transcription; Hindi/auto require a multilingual local model. */
  language?: SpeechLanguage;
  signal?: AbortSignal;
  /** Default 180 seconds. A worker may choose a tighter budget. */
  maxDurationSec?: number;
  reuseExisting?: boolean;
}

export interface AnalyzeResult {
  analysis: MediaAnalysis;
  /** Absolute paths on disk. */
  dir: string;
  sourcePath: string;
  /** ms per step + total. Steps run in parallel, so they don't sum to total. */
  timings: Record<string, number>;
  proxyMode?: string;
  cached?: boolean;
}

/**
 * Analyse an uploaded video into a MediaAnalysis (packages/core contract).
 * Writes <mediaDir>/<videoId>/{source.mp4, frames/*.jpg, analysis.json, transcript.json}.
 */
export async function analyzeVideo(inputPath: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const videoId = opts.videoId ?? newVideoId();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(videoId)) throw new MediaError("INVALID_MEDIA", "Invalid media identifier.");
  const root = opts.mediaDir ?? MEDIA_DIR;
  const prefix = (opts.urlPrefix ?? MEDIA_URL_PREFIX).replace(/\/$/, "");
  const dir = path.join(root, videoId);
  const framesDir = path.join(dir, "frames");
  const input = path.resolve(inputPath);
  const maxDuration = opts.maxDurationSec ?? 180;
  if (!Number.isFinite(maxDuration) || maxDuration <= 0 || maxDuration > 180) throw new MediaError("DURATION_LIMIT", "Analysis currently supports clips up to 180 seconds. Trim the video and retry.");
  if (opts.maxFrames !== undefined && (!Number.isInteger(opts.maxFrames) || opts.maxFrames < 1 || opts.maxFrames > 32)) throw new MediaError("INVALID_MEDIA", "Choose between 1 and 32 preview frames.");
  const p = await timed(timings, "probe", () => probe(input, { signal: opts.signal }));
  if (p.durationSec > maxDuration) throw new MediaError("DURATION_LIMIT", `This clip exceeds the ${maxDuration}-second analysis limit. Trim it and retry.`);
  const speech = p.hasAudio ? speechConfig(opts.language) : undefined;
  const inputStat = await stat(input);
  const modelStat = speech ? await stat(speech.model) : undefined;
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 4, input, bytes: inputStat.size, modified: inputStat.mtimeMs, model: speech?.model, modelBytes: modelStat?.size, modelModified: modelStat?.mtimeMs, language: speech?.language, skipProxy: !!opts.skipProxy, frames: opts.maxFrames ?? 16, threshold: opts.sceneThreshold ?? 0.3, prefix })).digest("hex");
  if (opts.reuseExisting !== false) {
    try {
      const cachedMeta = JSON.parse(await readFile(path.join(dir, "analysis.meta.json"), "utf8"));
      const analysis = MediaAnalysis.parse(JSON.parse(await readFile(path.join(dir, "analysis.json"), "utf8")));
      if (cachedMeta.fingerprint === fingerprint && analysis.videoId === videoId) {
        const sourcePath = frameUrlToPath(analysis.src, { mediaDir: root, urlPrefix: prefix });
        await Promise.all([access(sourcePath), ...analysis.frames.map((frame) => access(frameUrlToPath(frame.url, { mediaDir: root, urlPrefix: prefix })))]);
        opts.signal?.throwIfAborted();
        timings.total = Math.round(performance.now() - t0);
        return { analysis, dir, sourcePath, timings, proxyMode: "cached", cached: true };
      }
    } catch { /* Missing, stale or incomplete output is rebuilt. */ }
  }
  opts.signal?.throwIfAborted();
  await mkdir(framesDir, { recursive: true });
  let sourcePath = path.join(dir, "source.mp4");
  if (!opts.skipProxy && path.resolve(sourcePath) === input) throw new MediaError("INVALID_MEDIA", "Choose a separate output directory so analysis can preserve the original upload.");
  if (opts.skipProxy) {
    // Serve the original file as-is (reference videos: we only display them, never render).
    if (path.dirname(input) === dir) sourcePath = input;
    else {
      sourcePath = path.join(dir, "source" + (path.extname(input) || ".mp4"));
      await link(input, sourcePath).catch(() => copyFile(input, sourcePath));
    }
  }

  // Everything below reads the original input independently, so it all runs concurrently.
  const controller = new AbortController();
  const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
  const runOptions = { signal, timeoutMs: 120_000 };
  const warnings: string[] = [];
  const proxyP = opts.skipProxy
    ? Promise.resolve(undefined)
    : timed(timings, "proxy", () => makeProxy(input, sourcePath, p, runOptions));
  const wordsP = timed(timings, "transcript", () => transcribe(input, dir, p.hasAudio, { ...runOptions, language: speech?.language, onWarning: (message) => warnings.push(message) }));
  const loudP = timed(timings, "loudness", () => loudnessEnvelope(input, p.hasAudio, p.durationSec, runOptions));
  const scenesP = timed(timings, "scenes", () => detectCuts(input, opts.sceneThreshold ?? 0.3, p.durationSec, runOptions)).then((cuts) =>
    cutsToScenes(cuts, p.durationSec),
  );
  const framesP = scenesP.then((scenes) =>
    timed(timings, "frames", () =>
      extractFrames(input, framesDir, pickFrameTimes(p.durationSec, scenes.map((s) => s.start), opts.maxFrames ?? 16), 512, runOptions),
    ),
  );

  const tasks = [proxyP, wordsP, loudP, scenesP, framesP] as const;
  const [proxyMode, rawWords, loudness, scenes, frames] = await Promise.all(tasks).catch(async (error) => {
    controller.abort();
    await Promise.allSettled(tasks);
    if (error instanceof MediaError) throw error;
    throw new MediaError("ANALYSIS_FAILED", "Video analysis failed. Try a shorter MP4 clip and retry.");
  });
  const hasSpeech = looksLikeSpeech(rawWords, p.durationSec, loudness);
  const words = hasSpeech ? rawWords : [];

  const frameUrl = (name: string) => `${prefix}/${videoId}/frames/${name}`;
  const analysis = MediaAnalysis.parse({
    videoId,
    src: `${prefix}/${videoId}/${path.basename(sourcePath)}`,
    durationSec: p.durationSec,
    width: p.width,
    height: p.height,
    fps: p.fps,
    hasSpeech,
    words,
    scenes: scenes.map((s) => {
      const f = frames.find((fr) => fr.t >= s.start && fr.t < s.end);
      return f ? { ...s, thumb: frameUrl(f.name) } : s;
    }),
    frames: frames.map((f) => ({ t: f.t, url: frameUrl(f.name) })),
    loudness,
    ...(warnings.length ? { warnings } : {}),
  });

  timings.total = Math.round(performance.now() - t0);
  await writeFile(path.join(dir, "analysis.json.tmp"), JSON.stringify(analysis, null, 1));
  await rename(path.join(dir, "analysis.json.tmp"), path.join(dir, "analysis.json"));
  await writeFile(path.join(dir, "analysis.meta.json"), JSON.stringify({ fingerprint, language: speech?.language ?? null }));
  return { analysis, dir, sourcePath, timings, proxyMode };
}

/** Local file path of a frame URL produced by analyzeVideo (for sending images to the agent). */
export function frameUrlToPath(url: string, opts: { mediaDir?: string; urlPrefix?: string } = {}): string {
  const prefix = (opts.urlPrefix ?? MEDIA_URL_PREFIX).replace(/\/$/, "");
  if (!url.startsWith(prefix + "/") || /[?#\\\0]/.test(url)) throw new MediaError("INVALID_MEDIA", "Invalid local media URL.");
  const root = path.resolve(opts.mediaDir ?? MEDIA_DIR);
  let relative: string;
  try { relative = decodeURIComponent(url.slice(prefix.length + 1)); } catch { throw new MediaError("INVALID_MEDIA", "Invalid local media URL."); }
  if (/[\\\0]/.test(relative)) throw new MediaError("INVALID_MEDIA", "Invalid local media URL.");
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) throw new MediaError("INVALID_MEDIA", "Invalid local media URL.");
  return resolved;
}
