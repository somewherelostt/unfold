import { constants } from "node:fs";
import { access, stat, statfs } from "node:fs/promises";
import path from "node:path";
import type { RuntimeConfig } from "./config.ts";
import { JobStore } from "./store.ts";

type Check = { ok: boolean; detail: string };
export type Readiness = { ready: boolean; checkedAt: number; checks: Record<string, Check> };
async function executable(command: string): Promise<boolean> {
  const candidates = path.isAbsolute(command) ? [command] : (process.env.PATH ?? "").split(path.delimiter).map((dir) => path.join(dir, command));
  for (const file of candidates) { try { await access(file, constants.X_OK); if ((await stat(file)).isFile()) return true; } catch {} }
  return false;
}
/** No inference, browser download or credential echo. Gateway reachability is not an inference test. */
export async function checkReadiness(config: RuntimeConfig, store: JobStore, options: { requireWorker?: boolean; now?: number } = {}): Promise<Readiness> {
  const now = options.now ?? Date.now();
  const checks: Record<string, Check> = {};
  checks.runtime = { ok: Number(process.versions.node.split(".")[0]) >= 24 && process.platform !== "win32", detail: "Node >=24 and a POSIX process supervisor are required." };
  const tools = { ffmpeg: config.ffmpeg, ffprobe: config.ffprobe, speech: config.speechExecutable, bun: config.bunExecutable, browser: config.browserExecutable };
  const toolResults = await Promise.all(Object.entries(tools).map(async ([name, command]) => [name, await executable(command)] as const));
  for (const [name, ok] of toolResults) checks[name] = { ok, detail: ok ? "Executable available." : "Required executable is unavailable; provision it before startup." };
  try { await access(config.speechModel, constants.R_OK); checks.speechModel = { ok: true, detail: "Local speech model is readable." }; }
  catch { checks.speechModel = { ok: false, detail: "Local speech model is unavailable." }; }
  try {
    const health = store.health();
    checks.storage = { ok: health.storage, detail: "SQLite integrity and access checked on configured storage." };
    checks.leases = { ok: health.expiredLeases === 0, detail: health.expiredLeases ? "Interrupted executions require confirmed-stop recovery." : "No expired execution leases." };
    checks.runtimeBudget = { ok: health.overdueJobs === 0, detail: health.overdueJobs ? "An execution exceeded its runtime budget; capacity remains held until it stops." : "Executions are within their runtime budgets." };
    if (options.requireWorker) checks.worker = { ok: health.latestWorkerAt !== null && now - health.latestWorkerAt < config.limits.leaseMs, detail: "A worker heartbeat must be recent." };
    const disk = await statfs(path.dirname(store.databasePath));
    const free = Number(disk.bavail) * Number(disk.bsize);
    checks.disk = { ok: free >= config.minFreeBytes, detail: free >= config.minFreeBytes ? "Storage has the configured free-space reserve." : "Storage is below the configured free-space reserve." };
    const artifactsDisk = await statfs(store.artifactRoot);
    checks.artifactDisk = { ok: Number(artifactsDisk.bavail) * Number(artifactsDisk.bsize) >= config.minFreeBytes, detail: "Scratch storage must retain its configured free-space reserve." };
  } catch { checks.storage = { ok: false, detail: "Persistent storage is unavailable." }; }
  let bindingsReadable = false;
  try { if (config.bindingsModule) { await access(config.bindingsModule, constants.R_OK); bindingsReadable = (await stat(config.bindingsModule)).isFile(); } } catch {}
  checks.bindings = { ok: bindingsReadable, detail: bindingsReadable ? "An owner-bound handler module is configured and readable." : "A readable owner-bound storage binding has not been configured." };
  if (config.requireGateway) {
    checks.gatewayToken = { ok: config.gatewayTokenConfigured, detail: config.gatewayTokenConfigured ? "A gateway credential is configured; it was not disclosed or used for inference." : "Gateway credential is not configured." };
    try {
      const response = await fetch(new URL("/health", config.gatewayUrl), { signal: AbortSignal.timeout(2_000), redirect: "error" });
      await response.body?.cancel();
      checks.gateway = { ok: response.ok, detail: response.ok ? "OpenClaw health endpoint is reachable; Kimi/Cerebras inference was not exercised." : "OpenClaw health endpoint is not ready." };
    } catch { checks.gateway = { ok: false, detail: "OpenClaw health endpoint is unreachable." }; }
  }
  return { ready: Object.values(checks).every((check) => check.ok), checkedAt: now, checks };
}
