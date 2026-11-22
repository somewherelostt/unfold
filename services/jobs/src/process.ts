import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { JobStore } from "./store.ts";
import type { Claim } from "./types.ts";
import { HandlerFailure } from "./types.ts";

export type IsolatedProcessOptions = {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal: AbortSignal;
  terminateGraceMs?: number;
  onLine?: (line: string) => void;
  /** Private metadata enables conservative recovery after a supervisor restart. */
  record?: { file: string; token: string; workerId: string };
};

function groupExists(pid: number) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
function processExists(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
/** Never kills an unknown/reused process. A live or unverifiable group keeps the lease occupied. */
export async function verifyRecordedExecutionStopped(store: JobStore, claim: Claim): Promise<boolean> {
  try {
    const worker = JSON.parse(await readFile(path.join(store.workspace(claim), "worker.json"), "utf8"));
    if (worker.token !== claim.lease.token || worker.workerId !== claim.lease.workerId || worker.hostname !== os.hostname() || !Number.isSafeInteger(worker.pid) || worker.pid < 1) return false;
    // A stopped media child alone says nothing about an old worker still resolving/publishing.
    if (!worker.stoppedAt && processExists(worker.pid)) return false;
    if (worker.stoppedAt) return true; // Handler contract includes all of its owned subprocesses.
    const record = JSON.parse(await readFile(path.join(store.workspace(claim), "process.json"), "utf8"));
    if (record.token !== claim.lease.token || record.workerId !== claim.lease.workerId || record.hostname !== os.hostname() || !Number.isSafeInteger(record.pid) || record.pid < 1) return false;
    return Boolean(record.stoppedAt) || !groupExists(record.pid);
  } catch { return false; }
}

/** POSIX process group isolation stops the tool and FFmpeg/browser descendants before settling. */
export function runIsolatedProcess(options: IsolatedProcessOptions): Promise<void> {
  options.signal.throwIfAborted();
  if (process.platform === "win32") throw new HandlerFailure("UNSUPPORTED_RUNTIME", "The worker requires a POSIX process supervisor.");
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd, env: options.env ?? process.env, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    let pending = "";
    let spawnError: Error | null = null;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let aborting = false;
    const metadata = { pid: child.pid, hostname: os.hostname(), token: options.record?.token, workerId: options.record?.workerId, startedAt: Date.now(), stoppedAt: null as number | null };
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") spawnError ??= error as Error; }
    };
    const abort = () => {
      if (aborting) return;
      aborting = true;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), options.terminateGraceMs ?? 2_000);
    };
    if (options.record && child.pid) {
      try { writeFileSync(options.record.file, JSON.stringify(metadata), { mode: 0o600 }); }
      catch (error) { spawnError = error as Error; abort(); }
    }
    child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString();
      // Bound untrusted tool output, including a stream without newlines.
      if (pending.length > 64_000) pending = pending.slice(-64_000);
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try { options.onLine?.(line); } catch { abort(); }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-8_000); });
    child.on("error", (error) => { spawnError = error; });
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    child.on("close", async (code) => {
      options.signal.removeEventListener("abort", abort);
      if (killTimer) clearTimeout(killTimer);
      // A tool may exit before its descendants. Kill any remaining members of this owned group.
      kill("SIGKILL");
      // Do not free capacity while a descendant is still alive. The service supervisor also owns
      // its entire control group, including children which do not cooperate with shutdown.
      while (child.pid && groupExists(child.pid)) { await delay(25); kill("SIGKILL"); }
      if (options.record && child.pid) {
        metadata.stoppedAt = Date.now();
        try { writeFileSync(options.record.file, JSON.stringify(metadata), { mode: 0o600 }); }
        catch (error) { spawnError ??= error as Error; }
      }
      if (options.signal.aborted) reject(options.signal.reason ?? new Error("Execution aborted"));
      else if (spawnError || code !== 0) {
        // Tool logs can contain paths/credentials; keep them out of durable state and transport.
        void tail;
        reject(new HandlerFailure(spawnError ? "TOOL_UNAVAILABLE" : "TOOL_FAILED", spawnError ? "A required execution tool is unavailable." : "The media tool could not complete this job."));
      } else resolve();
    });
  });
}
