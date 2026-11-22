import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MediaError } from "./errors.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVICE_ROOT = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(SERVICE_ROOT, "../..");

/** Where analysed media lives: <repo>/data/media/<videoId>/ (served at /media/<videoId>/...). */
export const DATA_DIR = process.env.UNFOLD_DATA_DIR ?? path.join(REPO_ROOT, "data");
export const MEDIA_DIR = path.join(DATA_DIR, "media");
/** Public URL prefix the web app serves MEDIA_DIR under. */
export const MEDIA_URL_PREFIX = process.env.UNFOLD_MEDIA_URL_PREFIX ?? "/media";

export const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
/** Video downloader for reference links. */
export const DOWNLOADER_BIN = process.env.UNFOLD_DOWNLOADER_BIN ?? "yt-dlp";
/** Local speech-to-text CLI + model (word-level timestamps). */
export const STT_BIN = process.env.UNFOLD_STT_BIN ?? "whisper-cli";
export const STT_MODEL =
  process.env.UNFOLD_STT_MODEL ?? path.join(SERVICE_ROOT, "models", "ggml-base.en.bin");
export type SpeechLanguage = "en" | "hi" | "auto";
export function speechConfig(language?: SpeechLanguage) {
  const selected = language ?? process.env.UNFOLD_STT_LANGUAGE ?? "en";
  if (!["en", "hi", "auto"].includes(selected)) throw new MediaError("INVALID_MEDIA", "Choose English, Hindi or automatic language detection.");
  const model = selected === "en" ? STT_MODEL : process.env.UNFOLD_STT_MULTILINGUAL_MODEL ?? path.join(SERVICE_ROOT, "models", "ggml-base.bin");
  if (!existsSync(model) || (selected !== "en" && /\.en\./i.test(path.basename(model)))) {
    throw new MediaError("SPEECH_MODEL_MISSING", selected === "en" ? "The English speech model is not installed. Configure UNFOLD_STT_MODEL and retry." : "Hindi and automatic language detection require a multilingual speech model. Configure UNFOLD_STT_MULTILINGUAL_MODEL and retry.");
  }
  return { language: selected as SpeechLanguage, model };
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a process, capture output. Rejects on non-zero exit unless allowFail. */
export interface RunOptions { allowFail?: boolean; cwd?: string; signal?: AbortSignal; timeoutMs?: number }
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new MediaError("CANCELLED", "Media analysis was cancelled.")); return; }
    // A downloader may spawn a decoder. Isolate the group so cancellation stops both.
    const grouped = process.platform !== "win32";
    const p = spawn(cmd, args, { cwd: opts.cwd, detached: grouped, stdio: ["ignore", "pipe", "pipe"] });
    let out = Buffer.alloc(0), err = Buffer.alloc(0);
    const append = (previous: Buffer, chunk: Buffer) => Buffer.concat([previous, chunk]).subarray(-8 * 1024 * 1024);
    p.stdout.on("data", (d) => { out = append(out, d); });
    p.stderr.on("data", (d) => { err = append(err, d); });
    let stopped: MediaError | undefined;
    const stop = (error: MediaError) => {
      if (stopped) return;
      stopped = error;
      if (grouped && p.pid) {
        try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); }
      } else p.kill("SIGKILL");
    };
    const abort = () => stop(new MediaError("CANCELLED", "Media analysis was cancelled."));
    const timer = setTimeout(() => stop(new MediaError("TIMEOUT", "A media analysis step took too long. Try a shorter clip or retry the job.")), opts.timeoutMs ?? 120_000);
    timer.unref();
    opts.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => { clearTimeout(timer); opts.signal?.removeEventListener("abort", abort); };
    p.on("error", (e) => { cleanup(); reject(new Error(`${cmd}: ${e.message}`)); });
    p.on("close", (code) => {
      cleanup();
      if (stopped) { reject(stopped); return; }
      const r = { stdout: out.toString(), stderr: err.toString(), code: code ?? -1 };
      if (r.code !== 0 && !opts.allowFail) {
        reject(new Error(`${cmd} ${args.join(" ")} exited ${r.code}\n${r.stderr.slice(-2000)}`));
      } else resolve(r);
    });
  });
}

export async function timed<T>(timings: Record<string, number>, key: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    timings[key] = Math.round(performance.now() - t0);
  }
}

export const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function newVideoId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function assertTool(bin: string) {
  if (path.isAbsolute(bin) && !existsSync(bin)) throw new Error(`missing tool: ${bin}`);
}
