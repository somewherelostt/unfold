/** Server-only inspection of an actual completed MP4. No model calls or remote media downloads. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { EditPlan, MediaAnalysis } from "@unfold/core";
import { checkPlanQuality, fingerprintPlan, reviewFrameSamples, type RenderedQualityReview, type ReviewInterval } from "./quality";
export { fingerprintPlan } from "./quality";

export type RenderReviewOptions = {
  outputPath: string;
  reviewDir: string;
  publicDir: string;
  mediaDir?: string;
  analysis?: MediaAnalysis;
  signal?: AbortSignal;
  ffmpegExecutable?: string;
  ffprobeExecutable?: string;
  /** A trusted owner-bound storage resolver. Never accept filesystem paths from an API caller. */
  resolveAsset?: (src: string) => string | null | Promise<string | null>;
  /** Inspection is capped at 120 seconds; frame sampling remains capped at 18 images. */
  maxSeconds?: number;
};

function command(executable: string, args: string[], signal?: AbortSignal): Promise<{ stdout: Buffer; stderr: string }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    execFile(executable, args, { signal, encoding: "buffer", maxBuffer: 128 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (signal?.aborted) return reject(signal.reason);
      if (error) return reject(new Error(`${path.basename(executable)} inspection failed: ${stderr.toString().slice(-1200)}`));
      resolve({ stdout, stderr: stderr.toString() });
    });
  });
}

type Probe = { streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; sample_rate?: string; channels?: number }[]; format: { duration?: string } };
async function probe(file: string, opts: RenderReviewOptions): Promise<Probe> {
  const result = await command(opts.ffprobeExecutable ?? "ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,sample_rate,channels", "-of", "json", file], opts.signal);
  return JSON.parse(result.stdout.toString());
}

async function assetPath(src: string, opts: RenderReviewOptions): Promise<string | null> {
  if (opts.resolveAsset) {
    const resolved = await opts.resolveAsset(src);
    return resolved && path.isAbsolute(resolved) && existsSync(resolved) ? resolved : null;
  }
  if (/^[a-z]+:/i.test(src)) return null;
  let pathname: string;
  try { pathname = decodeURIComponent(src.split(/[?#]/)[0]); } catch { return null; }
  const media = pathname.startsWith("/media/");
  const root = media ? opts.mediaDir : opts.publicDir;
  if (!root) return null;
  const relative = media ? pathname.slice(7) : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(path.resolve(root) + path.sep) && existsSync(resolved) ? resolved : null;
}

export function parseInspectionIntervals(log: string, prefix: "black" | "freeze" | "silence", end: number): ReviewInterval[] {
  const intervals: ReviewInterval[] = [];
  let start: number | null = null;
  for (const match of log.matchAll(new RegExp(`${prefix}_(start|end):\\s*(-?[\\d.]+)`, "g"))) {
    const time = Math.max(0, Math.min(end, Number(match[2])));
    if (match[1] === "start") start = time;
    else if (start !== null) { if (time > start) intervals.push({ start, end: time }); start = null; }
  }
  if (start !== null && end > start) intervals.push({ start, end });
  return intervals;
}

function audioStats(buffer: Buffer) {
  let squares = 0, peak = 0, fullScaleSamples = 0;
  const samples = Math.floor(buffer.length / 4);
  for (let i = 0; i < samples; i++) {
    const sample = buffer.readFloatLE(i * 4);
    if (!Number.isFinite(sample)) continue;
    squares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    if (Math.abs(sample) >= 1) fullScaleSamples++;
  }
  const db = (value: number) => value > 0 ? 20 * Math.log10(value) : null;
  return { samples, fullScaleSamples, peakDbfs: db(peak), rmsDbfs: db(Math.sqrt(squares / Math.max(1, samples))) };
}

function correlate(reference: Buffer, output: Buffer, time: number, seconds: number) {
  const rate = 16000, begin = Math.round(Math.max(0, Math.min(seconds - 0.25, time)) * rate);
  const length = Math.min(4000, Math.floor(reference.length / 4) - begin, Math.floor(output.length / 4) - begin);
  let energy = 0, outputEnergy = 0;
  for (let i = 0; i < length; i++) { energy += reference.readFloatLE((begin + i) * 4) ** 2; outputEnergy += output.readFloatLE((begin + i) * 4) ** 2; }
  const rms = Math.sqrt(energy / Math.max(1, length));
  const outputRms = Math.sqrt(outputEnergy / Math.max(1, length));
  const outputRmsDbfs = outputRms > 0 ? 20 * Math.log10(outputRms) : null;
  if (length < 800 || rms < 0.003) return { correlation: null, lagMs: null, referenceRmsDbfs: rms > 0 ? 20 * Math.log10(rms) : null, outputRmsDbfs };
  let best = -1, bestLag = 0;
  for (let lag = -800; lag <= 800; lag += 4) {
    if (begin + lag < 0 || begin + length + lag > output.length / 4) continue;
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < length; i += 4) {
      const x = reference.readFloatLE((begin + i) * 4), y = output.readFloatLE((begin + i + lag) * 4);
      xy += x * y; xx += x * x; yy += y * y;
    }
    const value = xy / Math.sqrt(xx * yy || 1);
    if (value > best) { best = value; bestLag = lag; }
  }
  return { correlation: best, lagMs: bestLag / rate * 1000, referenceRmsDbfs: 20 * Math.log10(rms), outputRmsDbfs };
}

const GLYPHS: Record<string, number[]> = {
  "0": [14,17,19,21,25,17,14], "1": [4,12,4,4,4,4,14], "2": [14,17,1,2,4,8,31], "3": [30,1,1,14,1,1,30],
  "4": [2,6,10,18,31,2,2], "5": [31,16,16,30,1,1,30], "6": [14,16,16,30,17,17,14], "7": [31,1,2,4,8,8,8],
  "8": [14,17,17,14,17,17,14], "9": [14,17,17,15,1,1,14], ":": [0,4,4,0,4,4,0], ".": [0,0,0,0,0,12,12],
};

async function contactSheet(plan: EditPlan, opts: RenderReviewOptions): Promise<RenderedQualityReview["artifacts"]> {
  const samples = reviewFrameSamples(plan);
  const width = plan.height > plan.width ? 180 : 320;
  const height = Math.max(2, Math.round(width * plan.height / plan.width / 2) * 2);
  const cellHeight = height + 24, columns = Math.min(4, samples.length), rows = Math.ceil(samples.length / columns);
  const sheetWidth = columns * width, sheet = Buffer.alloc(sheetWidth * rows * cellHeight * 3);
  const frames: RenderedQualityReview["artifacts"]["frames"] = [];
  await mkdir(path.join(opts.reviewDir, "frames"), { recursive: true });
  for (const [index, sample] of samples.entries()) {
    opts.signal?.throwIfAborted();
    const file = `frames/${String(index + 1).padStart(2, "0")}.png`;
    const { stdout } = await command(opts.ffmpegExecutable ?? "ffmpeg", ["-y", "-v", "error", "-ss", sample.time.toFixed(6), "-i", opts.outputPath,
      "-map", "0:v:0", "-frames:v", "1", path.join(opts.reviewDir, file), "-map", "0:v:0", "-frames:v", "1", "-vf", `scale=${width}:${height}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], opts.signal);
    if (stdout.length !== width * height * 3) throw new Error("A sampled composition frame could not be decoded.");
    const x = index % columns * width, y = Math.floor(index / columns) * cellHeight;
    for (let row = 0; row < height; row++) stdout.copy(sheet, ((y + row) * sheetWidth + x) * 3, row * width * 3, (row + 1) * width * 3);
    const minutes = Math.floor(sample.time / 60), sec = (sample.time % 60).toFixed(3).padStart(6, "0");
    const label = `${String(index + 1).padStart(2, "0")} ${String(minutes).padStart(2, "0")}:${sec}`;
    for (const [character, glyph] of [...label].map((c, i) => [i, GLYPHS[c] ?? []] as const)) for (let gy = 0; gy < glyph.length; gy++) for (let gx = 0; gx < 5; gx++) {
      if (!(glyph[gy] & (1 << (4 - gx)))) continue;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const pixel = ((y + height + 4 + gy * 2 + dy) * sheetWidth + x + 4 + character * 12 + gx * 2 + dx) * 3;
        sheet.fill(235, pixel, pixel + 3);
      }
    }
    frames.push({ ...sample, file });
  }
  const ppm = path.join(opts.reviewDir, ".contact.ppm");
  try {
    await writeFile(ppm, Buffer.concat([Buffer.from(`P6\n${sheetWidth} ${rows * cellHeight}\n255\n`), sheet]));
    await command(opts.ffmpegExecutable ?? "ffmpeg", ["-y", "-v", "error", "-i", ppm, "-frames:v", "1", path.join(opts.reviewDir, "contact-sheet.png")], opts.signal);
  } finally { await rm(ppm, { force: true }); }
  return { report: "review.json", contactSheet: "contact-sheet.png", frames };
}

/** Call with the trusted effective plan, not the separate ephemeral URL-capability clone. */
export async function reviewRenderedPlan(plan: EditPlan, opts: RenderReviewOptions): Promise<RenderedQualityReview> {
  opts.signal?.throwIfAborted();
  const base = checkPlanQuality(plan, opts.analysis);
  const report: RenderedQualityReview = { ...base, version: 1, planId: plan.id, planFingerprint: await fingerprintPlan(plan),
    coverage: { plan: "Deterministic timing/reference checks", transcript: opts.analysis ? "Caption checks use supplied timed recognition, not independently established speech truth; untimed/missed recognition needs listening" : "No primary word analysis supplied", textReadability: "Requires human inspection of sampled composition pixels; no OCR or taste score", musicAndSfxAudition: "Not auditioned; measured loudness does not establish musical fit" },
    metrics: { durationSec: 0, width: 0, height: 0, fps: 0, blackIntervals: [], frozenIntervals: [] },
    artifacts: { report: "review.json", contactSheet: "", frames: [] } };
  await mkdir(opts.reviewDir, { recursive: true });
  const assets = [{ src: plan.source.src, label: "Primary source" }, ...(plan.broll ?? []).map((shot) => ({ src: plan.supporting?.find((a) => a.videoId === shot.assetId)?.src ?? "", label: `Supporting placement ${shot.id}` })),
    ...(plan.music ? [{ src: plan.music.url, label: "Music" }] : []), ...plan.sfx.map((s, i) => ({ src: s.url, label: `Sound effect ${i + 1}` }))];
  const resolved = new Map<string, string>();
  for (const asset of assets) {
    if (resolved.has(asset.src)) continue;
    const file = await assetPath(asset.src, opts);
    if (file) resolved.set(asset.src, file);
    else report.errors.push(`${asset.label} is unavailable to the trusted local review resolver.`);
  }
  let info: Probe;
  try { info = await probe(opts.outputPath, opts); }
  catch (error) { opts.signal?.throwIfAborted(); report.errors.push("The exported media could not be inspected."); info = { streams: [], format: {} }; }
  const video = info.streams.find((s) => s.codec_type === "video"), audio = info.streams.find((s) => s.codec_type === "audio");
  const [numerator, denominator = 1] = (video?.r_frame_rate ?? "0/1").split("/").map(Number);
  Object.assign(report.metrics, { durationSec: Number(info.format.duration ?? 0), width: video?.width ?? 0, height: video?.height ?? 0, fps: numerator / denominator });
  if (!video) report.errors.push("The exported media has no video stream.");
  if (video && (video.width !== plan.width || video.height !== plan.height || Math.abs(report.metrics.fps - plan.fps) > 0.001)) report.errors.push("The exported dimensions or frame rate differ from the effective plan.");
  if (Math.abs(report.metrics.durationSec - plan.durationSec) > Math.max(0.15, 2 / plan.fps)) report.errors.push("The exported duration differs from the effective plan.");
  const seconds = Math.min(report.metrics.durationSec, Math.max(0.1, opts.maxSeconds ?? 120), 120);
  if (seconds < report.metrics.durationSec - 0.01) report.warnings.push(`Video/audio signal inspection covers the first ${seconds.toFixed(2)} seconds only.`);
  if (video) {
    const inspected = await command(opts.ffmpegExecutable ?? "ffmpeg", ["-v", "info", "-nostats", "-i", opts.outputPath, "-t", String(seconds), "-an", "-vf", "blackdetect=d=0.12:pic_th=0.98:pix_th=0.10,freezedetect=n=-50dB:d=0.8", "-f", "null", "-"], opts.signal);
    report.metrics.blackIntervals = parseInspectionIntervals(inspected.stderr, "black", seconds);
    report.metrics.frozenIntervals = parseInspectionIntervals(inspected.stderr, "freeze", seconds);
    report.coverage.videoSignals = `${seconds.toFixed(3)} seconds decoded for black/frozen spans; these can be intentional`;
    report.checks.push("Decoded video stream, duration, black and frozen intervals");
    if (report.metrics.blackIntervals.length) report.warnings.push("Dark/black intervals were measured; inspect their source and editorial context.");
    if (report.metrics.frozenIntervals.length) report.warnings.push("Frozen intervals were measured; a static product shot or held frame can be intentional.");
    if ([plan.fps, plan.width, plan.height, plan.durationSec].every((value) => Number.isFinite(value) && value > 0)) {
      report.artifacts = await contactSheet(plan, opts);
      report.coverage.compositionPixels = `${report.artifacts.frames.length} actual exported frames sampled; unsampled intervals are not visually reviewed`;
    } else report.coverage.compositionPixels = "Not sampled: invalid effective timeline dimensions or frame rate";
  }
  const source = resolved.get(plan.source.src);
  let sourceInfo: Probe | null = null;
  if (source) {
    try { sourceInfo = await probe(source, opts); }
    catch { opts.signal?.throwIfAborted(); report.errors.push("The primary source could not be inspected by the trusted local resolver."); }
  }
  const sourceHasAudio = sourceInfo?.streams.some((s) => s.codec_type === "audio");
  const selectedAudio = !!(plan.music && plan.music.volume > 0) || plan.sfx.some((s) => s.volume > 0);
  if (!audio && (sourceHasAudio || selectedAudio)) report.errors.push("The export lost an audio stream expected from its source or selected audio tracks.");
  if (!audio) report.coverage.audio = sourceHasAudio === false && !plan.music && !plan.sfx.length ? "No source or selected audio; absence is expected" : "No output audio stream";
  if (audio) {
    const decoded = await command(opts.ffmpegExecutable ?? "ffmpeg", ["-v", "info", "-nostats", "-i", opts.outputPath, "-t", String(seconds), "-vn", "-af", "ebur128=peak=true,silencedetect=n=-50dB:d=0.25", "-ac", "2", "-ar", "48000", "-f", "f32le", "pipe:1"], opts.signal);
    const loudness = [...decoded.stderr.matchAll(/\bI:\s*(-?[\d.]+) LUFS/g)].at(-1);
    report.metrics.audio = { ...audioStats(decoded.stdout), sampleRate: 48000, channels: 2, seconds, integratedLufs: loudness ? Number(loudness[1]) : null, silenceIntervals: parseInspectionIntervals(decoded.stderr, "silence", seconds) };
    report.coverage.audio = `${seconds.toFixed(3)} seconds decoded at 48 kHz stereo; RMS, sample peaks, LUFS and silence measured`;
    report.checks.push("Decoded audio presence, full-scale samples, silence and integrated loudness");
    if (report.metrics.audio.fullScaleSamples) report.warnings.push(`${report.metrics.audio.fullScaleSamples} decoded audio samples reached or exceeded full scale; inspect for clipping.`);
    if (report.metrics.audio.rmsDbfs === null && sourceHasAudio) report.warnings.push("The exported audio is silent despite an audio-bearing source; inspect whether this is intended.");
    if (plan.broll?.length && source && sourceHasAudio && plan.clips.length <= 64 && !base.errors.length) {
      const labels = plan.clips.map((_, i) => `[s${i}]`).join("");
      const graph = [`[0:a]asplit=${plan.clips.length}${labels}`, ...plan.clips.map((c, i) => `[s${i}]atrim=start=${c.srcStart}:end=${c.srcEnd},asetpts=PTS-STARTPTS,atempo=${c.speed}[c${i}]`), `${plan.clips.map((_, i) => `[c${i}]`).join("")}concat=n=${plan.clips.length}:v=0:a=1[voice]`].join(";");
      const reference = await command(opts.ffmpegExecutable ?? "ffmpeg", ["-v", "error", "-i", source, "-filter_complex", graph, "-map", "[voice]", "-t", String(seconds), "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], opts.signal);
      const mixed = await command(opts.ffmpegExecutable ?? "ffmpeg", ["-v", "error", "-i", opts.outputPath, "-t", String(seconds), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], opts.signal);
      const windows = (plan.broll ?? []).flatMap((b) => [{ time: Math.max(0, b.start - 0.3), label: `Before ${b.id}` }, { time: (b.start + b.end) / 2 - 0.125, label: `During ${b.id}` }, { time: b.end + 0.03, label: `After ${b.id}` }]).filter((w) => w.time + 0.25 <= seconds).slice(0, 36);
      report.metrics.narration = windows.map((window) => ({ ...window, ...correlate(reference.stdout, mixed.stdout, window.time, seconds) }));
      report.coverage.narration = windows.length ? "Waveform similarity against primary-source trims in 250 ms windows around cutaways; quiet references are inconclusive" : "No supporting windows within the inspected audio coverage";
      if (report.metrics.narration.some((w) => w.referenceRmsDbfs !== null && w.referenceRmsDbfs > -50 && (w.outputRmsDbfs === null || w.outputRmsDbfs < -65))) report.errors.push("Non-silent primary source audio disappeared around a supporting visual switch.");
      if (!plan.music && !plan.sfx.length && report.metrics.narration.some((w) => w.correlation !== null && w.correlation < 0.9)) report.warnings.push("Primary narration waveform differs around a cutaway; inspect synchronization or unintended supporting audio.");
    } else report.coverage.narration = !plan.broll?.length ? "No supporting visual switches to compare" : "Not compared: a trusted local audio source and valid bounded clip layout are required";
  }
  report.passed = report.errors.length === 0;
  report.errors = [...new Set(report.errors)]; report.warnings = [...new Set(report.warnings)];
  await writeFile(path.join(opts.reviewDir, "review.json"), JSON.stringify(report, null, 2));
  return report;
}
