import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a process, capture output. Rejects on non-zero exit unless allowFail. */
export function run(cmd: string, args: string[], opts: { allowFail?: boolean; cwd?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", (e) => reject(new Error(`${cmd}: ${e.message}`)));
    p.on("close", (code) => {
      const r = { stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString(), code: code ?? -1 };
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
