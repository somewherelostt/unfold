import path from "node:path";
import { existsSync } from "node:fs";
import { DEFAULT_LIMITS, JobFault, type JobLimits } from "./types.ts";

export type RuntimeConfig = {
  repoRoot: string;
  databasePath: string;
  artifactRoot: string;
  publicDir: string;
  browserExecutable: string;
  bunExecutable: string;
  ffmpeg: string;
  ffprobe: string;
  speechExecutable: string;
  speechModel: string;
  gatewayUrl: string;
  gatewayTokenConfigured: boolean;
  minFreeBytes: number;
  requireGateway: boolean;
  limits: JobLimits;
  bindingsModule: string | null;
};
export function loadJobConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const absolute = (value: string, name: string) => {
    if (!path.isAbsolute(value)) throw new JobFault("INVALID_CONFIG", `${name} must be an absolute path.`);
    return path.resolve(value);
  };
  // Bundlers interpret new URL(directory, import.meta.url) as an asset import. Resolve the
  // checkout from a trusted explicit root or cwd ancestors for web/worker CLI entry points.
  let repoRoot = env.UNFOLD_REPO_ROOT ? absolute(env.UNFOLD_REPO_ROOT, "UNFOLD_REPO_ROOT") : path.resolve(process.cwd());
  while (!existsSync(path.join(repoRoot, "services/jobs/package.json")) || !existsSync(path.join(repoRoot, "packages/core/package.json"))) {
    const parent = path.dirname(repoRoot);
    if (env.UNFOLD_REPO_ROOT || parent === repoRoot) throw new JobFault("INVALID_CONFIG", "Set UNFOLD_REPO_ROOT to the absolute Unfold checkout path.");
    repoRoot = parent;
  }
  const integer = (name: string, fallback: number) => {
    if (env[name] === undefined) return fallback;
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value < 1) throw new JobFault("INVALID_CONFIG", `${name} must be a positive integer.`);
    return value;
  };
  const dataRoot = absolute(env.UNFOLD_DATA_DIR ?? path.join(repoRoot, "data"), "UNFOLD_DATA_DIR");
  const limits: JobLimits = {
    maxQueued: integer("UNFOLD_JOBS_MAX_QUEUED", DEFAULT_LIMITS.maxQueued),
    maxOutstandingPerOwner: integer("UNFOLD_JOBS_MAX_PER_OWNER", DEFAULT_LIMITS.maxOutstandingPerOwner),
    maxRunning: integer("UNFOLD_JOBS_MAX_RUNNING", DEFAULT_LIMITS.maxRunning),
    maxRunningPerOwner: integer("UNFOLD_JOBS_RUNNING_PER_OWNER", DEFAULT_LIMITS.maxRunningPerOwner),
    maxRunningPerProject: integer("UNFOLD_JOBS_RUNNING_PER_PROJECT", DEFAULT_LIMITS.maxRunningPerProject),
    maxRenders: integer("UNFOLD_JOBS_MAX_RENDERS", DEFAULT_LIMITS.maxRenders),
    maxAnalysis: integer("UNFOLD_JOBS_MAX_ANALYSIS", DEFAULT_LIMITS.maxAnalysis),
    leaseMs: integer("UNFOLD_JOBS_LEASE_MS", DEFAULT_LIMITS.leaseMs),
    retryBaseMs: integer("UNFOLD_JOBS_RETRY_BASE_MS", DEFAULT_LIMITS.retryBaseMs),
    maxRuntimeMs: integer("UNFOLD_JOBS_MAX_RUNTIME_MS", DEFAULT_LIMITS.maxRuntimeMs),
  };
  const gateway = new URL(env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18890");
  if (!["http:", "https:"].includes(gateway.protocol) || gateway.username || gateway.password || gateway.search || gateway.hash) throw new JobFault("INVALID_CONFIG", "Invalid gateway endpoint.");
  return {
    repoRoot, databasePath: absolute(env.UNFOLD_JOBS_DB ?? path.join(dataRoot, "jobs/jobs.sqlite"), "UNFOLD_JOBS_DB"),
    artifactRoot: absolute(env.UNFOLD_JOBS_ARTIFACTS ?? path.join(dataRoot, "jobs/artifacts"), "UNFOLD_JOBS_ARTIFACTS"),
    publicDir: path.join(repoRoot, "apps/web/public"),
    browserExecutable: absolute(env.UNFOLD_BROWSER_EXECUTABLE ?? path.join(repoRoot, "apps/web/node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell"), "UNFOLD_BROWSER_EXECUTABLE"),
    bunExecutable: env.UNFOLD_BUN_BIN ?? "bun", ffmpeg: env.FFMPEG_PATH ?? "ffmpeg", ffprobe: env.FFPROBE_PATH ?? "ffprobe",
    speechExecutable: env.UNFOLD_STT_BIN ?? "whisper-cli", speechModel: absolute(env.UNFOLD_STT_MODEL ?? path.join(repoRoot, "services/media/models/ggml-base.en.bin"), "UNFOLD_STT_MODEL"),
    gatewayUrl: gateway.href, gatewayTokenConfigured: Boolean(env.OPENCLAW_GATEWAY_TOKEN),
    minFreeBytes: integer("UNFOLD_JOBS_MIN_FREE_BYTES", 1024 ** 3), requireGateway: env.UNFOLD_JOBS_REQUIRE_GATEWAY !== "false",
    limits, bindingsModule: env.UNFOLD_JOB_BINDINGS ? absolute(env.UNFOLD_JOB_BINDINGS, "UNFOLD_JOB_BINDINGS") : null,
  };
}
