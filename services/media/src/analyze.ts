import { copyFile, link, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MediaAnalysis } from "../../../packages/core/src/schema.ts";
import {
  cutsToScenes, detectCuts, extractFrames, looksLikeSpeech, loudnessEnvelope, makeProxy, pickFrameTimes, probe, transcribe,
} from "./steps.ts";
import { MEDIA_DIR, MEDIA_URL_PREFIX, newVideoId, timed } from "./util.ts";

export interface AnalyzeOptions {
  videoId?: string;
  /** Skip the proxy transcode (e.g. for reference videos we never render). Default false. */
  skipProxy?: boolean;
  sceneThreshold?: number;
  maxFrames?: number;
  /** Override output root (default <repo>/data/media). */
  mediaDir?: string;
  urlPrefix?: string;
}

export interface AnalyzeResult {
  analysis: MediaAnalysis;
  /** Absolute paths on disk. */
  dir: string;
  sourcePath: string;
  /** ms per step + total. Steps run in parallel, so they don't sum to total. */
  timings: Record<string, number>;
  proxyMode?: string;
}

/**
 * Analyse an uploaded video into a MediaAnalysis (packages/core contract).
 * Writes <mediaDir>/<videoId>/{source.mp4, frames/*.jpg, analysis.json, transcript.json}.
 */
export async function analyzeVideo(inputPath: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const videoId = opts.videoId ?? newVideoId();
  const root = opts.mediaDir ?? MEDIA_DIR;
  const prefix = (opts.urlPrefix ?? MEDIA_URL_PREFIX).replace(/\/$/, "");
  const dir = path.join(root, videoId);
  const framesDir = path.join(dir, "frames");
  await mkdir(framesDir, { recursive: true });
  const input = path.resolve(inputPath);
  let sourcePath = path.join(dir, "source.mp4");
  if (opts.skipProxy) {
    // Serve the original file as-is (reference videos: we only display them, never render).
    if (path.dirname(input) === dir) sourcePath = input;
    else {
      sourcePath = path.join(dir, "source" + (path.extname(input) || ".mp4"));
      await link(input, sourcePath).catch(() => copyFile(input, sourcePath));
    }
  }

  const p = await timed(timings, "probe", () => probe(input));

  // Everything below reads the original input independently, so it all runs concurrently.
  const proxyP = opts.skipProxy
    ? Promise.resolve(undefined)
    : timed(timings, "proxy", () => makeProxy(input, sourcePath, p));
  const wordsP = timed(timings, "transcript", () => transcribe(input, dir, p.hasAudio));
  const loudP = timed(timings, "loudness", () => loudnessEnvelope(input, p.hasAudio, p.durationSec));
  const scenesP = timed(timings, "scenes", () => detectCuts(input, opts.sceneThreshold ?? 0.3, p.durationSec)).then((cuts) =>
    cutsToScenes(cuts, p.durationSec),
  );
  const framesP = scenesP.then((scenes) =>
    timed(timings, "frames", () =>
      extractFrames(input, framesDir, pickFrameTimes(p.durationSec, scenes.map((s) => s.start), opts.maxFrames ?? 16)),
    ),
  );

  const [proxyMode, rawWords, loudness, scenes, frames] = await Promise.all([proxyP, wordsP, loudP, scenesP, framesP]);
  const hasSpeech = looksLikeSpeech(rawWords, p.durationSec);
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
  });

  timings.total = Math.round(performance.now() - t0);
  await writeFile(path.join(dir, "analysis.json"), JSON.stringify(analysis, null, 1));
  return { analysis, dir, sourcePath, timings, proxyMode };
}

/** Local file path of a frame URL produced by analyzeVideo (for sending images to the agent). */
export function frameUrlToPath(url: string, opts: { mediaDir?: string; urlPrefix?: string } = {}): string {
  const prefix = (opts.urlPrefix ?? MEDIA_URL_PREFIX).replace(/\/$/, "");
  return path.join(opts.mediaDir ?? MEDIA_DIR, url.slice(prefix.length + 1));
}
