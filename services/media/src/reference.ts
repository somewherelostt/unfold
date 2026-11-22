import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaAnalysis } from "../../../packages/core/src/schema.ts";
import { analyzeVideo, type AnalyzeOptions } from "./analyze.ts";
import { MEDIA_DIR, DOWNLOADER_BIN, newVideoId, round, run, timed } from "./util.ts";
import { resolvePublicReferenceUrl } from "./reference-url.ts";
import { MediaError } from "./errors.ts";

export interface CutStats {
  shots: number;
  cuts: number;
  cutsPerMinute: number;
  avgShotSec: number;
  medianShotSec: number;
  /** Fraction of the runtime with speech (0..1), useful for "talking head vs montage". */
  speechRatio: number;
  /** Mean loudness dB and its spread — rough proxy for music energy / dynamics. */
  meanDb: number | null;
  dbStdDev: number | null;
}

export interface ReferenceAnalysis {
  analysis: MediaAnalysis;
  stats: CutStats;
  sourceUrl: string | null;
  title: string | null;
  uploader: string | null;
  localPath: string;
  timings: Record<string, number>;
}

export function cutStats(a: MediaAnalysis): CutStats {
  const lens = a.scenes.map((s) => s.end - s.start).sort((x, y) => x - y);
  const cuts = Math.max(0, a.scenes.length - 1);
  const mins = a.durationSec / 60 || 1;
  const spoken = a.words.reduce((s, w) => s + (w.end - w.start), 0);
  const dbs = a.loudness.map((l) => l.db).filter((d) => d > -80);
  const mean = dbs.length ? dbs.reduce((s, d) => s + d, 0) / dbs.length : null;
  const sd = mean !== null ? Math.sqrt(dbs.reduce((s, d) => s + (d - mean) ** 2, 0) / dbs.length) : null;
  return {
    shots: a.scenes.length,
    cuts,
    cutsPerMinute: round(cuts / mins, 2),
    avgShotSec: round(a.durationSec / Math.max(1, a.scenes.length), 2),
    medianShotSec: round(lens.length ? lens[Math.floor(lens.length / 2)] : a.durationSec, 2),
    speechRatio: round(Math.min(1, spoken / (a.durationSec || 1)), 3),
    meanDb: mean === null ? null : round(mean, 1),
    dbStdDev: sd === null ? null : round(sd, 1),
  };
}

/**
 * Download a public platform inspiration video with the video downloader,
 * then analyse it like an upload and add cut-rate stats. Caps at 1080p, first 3 minutes.
 */
export async function fetchReference(url: string, opts: AnalyzeOptions & { maxSeconds?: number } = {}): Promise<ReferenceAnalysis> {
  const maxS = opts.maxSeconds ?? 180;
  if (!Number.isFinite(maxS) || maxS <= 0 || maxS > 180) throw new MediaError("DURATION_LIMIT", "Reference analysis supports up to 180 seconds. Upload a shorter reference clip.");
  if (opts.videoId && !/^[A-Za-z0-9_-]{1,80}$/.test(opts.videoId)) throw new MediaError("INVALID_MEDIA", "Invalid media identifier.");
  const safeUrl = await resolvePublicReferenceUrl(url, opts.signal);
  const timings: Record<string, number> = {};
  const refId = opts.videoId ?? `ref-${newVideoId()}`;
  const dlDir = path.join(opts.mediaDir ?? MEDIA_DIR, refId);
  await mkdir(dlDir, { recursive: true });
  const meta = await timed(timings, "download", async () => {
    const r = await run(DOWNLOADER_BIN, [
      "--ignore-config", "--no-cache-dir", "--no-playlist", "--no-progress", "--restrict-filenames",
      "--use-extractors", "default,-generic", "--socket-timeout", "15", "--retries", "1", "--fragment-retries", "1", "--max-filesize", "100M",
      "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b",
      "--merge-output-format", "mp4",
      "--download-sections", `*0-${maxS}`,
      "--print-json", "--no-simulate",
      "-o", path.join(dlDir, "input.%(ext)s"),
      safeUrl,
    ], { signal: opts.signal, timeoutMs: 120_000 }).catch((error) => {
      if (error instanceof MediaError) throw error;
      throw new MediaError("REFERENCE_URL", "The reference could not be downloaded. Upload the reference video file instead.");
    });
    const line = r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
    return line ? JSON.parse(line) : {};
  });
  const file = (await readdir(dlDir)).find((f) => f.startsWith("input.") && !f.endsWith(".part"));
  if (!file) throw new Error(`video downloader produced no file for ${url}`);
  const localPath = path.join(dlDir, file);
  const res = await analyzeReferenceFile(localPath, { ...opts, videoId: refId });
  const out: ReferenceAnalysis = {
    ...res,
    sourceUrl: url,
    title: meta.title ?? null,
    uploader: meta.uploader ?? meta.channel ?? null,
    timings: { ...timings, ...res.timings, total: (timings.download ?? 0) + (res.timings.total ?? 0) },
  };
  await writeFile(path.join(res.dir, "reference.json"), JSON.stringify({ ...out, analysis: undefined }, null, 1));
  return out;
}

/** Uploaded-file fallback for references (when a link can't be fetched). Skips the proxy by default. */
export async function analyzeReferenceFile(filePath: string, opts: AnalyzeOptions = {}) {
  if (!existsSync(filePath)) throw new Error(`no such file: ${filePath}`);
  const r = await analyzeVideo(filePath, { skipProxy: true, maxFrames: 12, ...opts, videoId: opts.videoId ?? `ref-${newVideoId()}` });
  return { analysis: r.analysis, stats: cutStats(r.analysis), localPath: filePath, timings: r.timings, dir: r.dir,
    sourceUrl: null as string | null, title: null as string | null, uploader: null as string | null };
}
