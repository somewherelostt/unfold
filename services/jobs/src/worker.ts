import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { JobStore, type FinishResult } from "./store.ts";
import { isHandlerFailure, isJobFault, JobFault, type Claim, type JobContext, type JobKind, type JobProgress, type OutputReference } from "./types.ts";

export type HandlerContext = JobContext & {
  job: Claim;
  workspace: string;
  signal: AbortSignal;
  progress: (progress: JobProgress) => void;
};
export type HandlerResult = { output: OutputReference; retainWorkspace?: boolean };
/** A handler must settle only after its subprocesses stop; never fire and forget work. */
export type JobHandler = (context: HandlerContext) => Promise<HandlerResult>;
export type WorkerOptions = {
  id?: string;
  handlers: Partial<Record<JobKind, JobHandler>>;
  pollMs?: number;
  heartbeatMs?: number;
  scratchRetentionMs?: number;
  onError?: (error: unknown) => void;
  verifyInterruptedExecutionStopped?: (claim: Claim) => Promise<boolean>;
};

export class JobWorker {
  readonly id: string;
  private readonly store: JobStore;
  private readonly options: WorkerOptions;
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private stopping = false;
  constructor(store: JobStore, options: WorkerOptions) {
    this.store = store; this.options = options; this.id = options.id ?? randomUUID();
    const entries = Object.entries(options.handlers);
    if (!entries.length || entries.some(([kind, handler]) => !["analysis", "render"].includes(kind) || typeof handler !== "function")) throw new JobFault("INVALID_CONFIG", "Configure at least one valid job handler.");
    const heartbeat = options.heartbeatMs ?? Math.max(25, Math.floor(store.limits.leaseMs / 3));
    if (heartbeat >= store.limits.leaseMs || heartbeat < 1) throw new JobFault("INVALID_CONFIG", "Heartbeat must be shorter than the lease.");
  }
  get activeCount() { return this.active.size; }
  /** One bounded scheduler pass, also useful in integration harnesses. Global limits live in SQLite. */
  tick(): number {
    if (this.stopping) return 0;
    this.store.workerSeen(this.id);
    let started = 0;
    while (this.active.size < this.store.limits.maxRunning) {
      const kinds = Object.keys(this.options.handlers) as JobKind[];
      if (!kinds.length) break;
      const claim = this.store.claim(this.id, kinds);
      if (!claim) break;
      const controller = new AbortController();
      const entry = { controller, done: Promise.resolve() };
      this.active.set(claim.id, entry);
      entry.done = this.execute(claim, controller).catch((error) => this.options.onError?.(error)).finally(() => this.active.delete(claim.id));
      started++;
    }
    return started;
  }
  private async execute(claim: Claim, controller: AbortController) {
    let heartbeatBusy = false;
    let lastProgress: JobProgress = { fraction: 0, stage: "starting" };
    let lastProgressAt = 0;
    let stopReason: "shutdown" | "timeout" | "lease" | "cancel" | null = null;
    const stop = (reason: typeof stopReason) => { stopReason ??= reason; controller.abort(); };
    const pulse = (progress?: JobProgress) => {
      if (heartbeatBusy) return;
      // Save useful changes while bounding renderer frame callbacks and durable event growth.
      if (progress && progress.stage === lastProgress.stage && progress.fraction !== 1 && progress.fraction - lastProgress.fraction < 0.01 && Date.now() - lastProgressAt < 1_000) return;
      heartbeatBusy = true;
      try {
        const status = this.store.heartbeat(claim, progress);
        if (progress) { lastProgress = progress; lastProgressAt = Date.now(); }
        if (status.cancelRequested) stop("cancel");
        else if (status.runtimeExceeded) stop("timeout");
      } catch { stop("lease"); }
      finally { heartbeatBusy = false; }
    };
    const heartbeat = setInterval(() => pulse(), this.options.heartbeatMs ?? Math.max(25, Math.floor(this.store.limits.leaseMs / 3)));
    const workerRecord = { pid: process.pid, hostname: os.hostname(), token: claim.lease.token, workerId: claim.lease.workerId, stoppedAt: null as number | null };
    const workerRecordFile = path.join(this.store.workspace(claim), "worker.json");
    let result: FinishResult;
    try {
      this.store.trackWorkspace(claim, this.options.scratchRetentionMs ?? 24 * 60 * 60_000);
      const workspace = this.store.workspace(claim);
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      await writeFile(workerRecordFile, JSON.stringify(workerRecord), { mode: 0o600 });
      pulse({ fraction: 0, stage: "preparing" });
      controller.signal.throwIfAborted();
      const handler = this.options.handlers[claim.kind]!;
      const output = await handler({ ownerId: claim.ownerId, projectId: claim.projectId, job: claim, workspace, signal: controller.signal, progress: (p) => pulse(p) });
      controller.signal.throwIfAborted();
      result = output;
    } catch (error) {
      if (controller.signal.aborted) {
        if (stopReason === "cancel") result = { cancelled: true };
        else result = { error: { code: stopReason === "timeout" ? "RUNTIME_LIMIT" : "WORKER_INTERRUPTED", message: stopReason === "timeout" ? "The job exceeded its execution time limit." : "The worker stopped before completing this job.", transient: stopReason !== "timeout" } };
      } else if (isHandlerFailure(error)) result = { error: { code: error.code, message: error.message, transient: error.transient } };
      else result = { error: { code: "EXECUTION_FAILED", message: "The job could not be completed.", transient: false } };
    } finally {
      clearInterval(heartbeat);
      workerRecord.stoppedAt = Date.now();
      try { await writeFile(workerRecordFile, JSON.stringify(workerRecord), { mode: 0o600 }); }
      catch { /* A missing proof record keeps future interrupted recovery conservative. */ }
    }
    // The handler has settled: owned work is stopped before capacity or the lease is released.
    try { this.store.finish(claim, result); }
    catch (error) { if (!isJobFault(error) || error.code !== "LEASE_LOST") throw error; }
  }
  async drain() { await Promise.all([...this.active.values()].map((entry) => entry.done)); }
  async stop() {
    this.stopping = true;
    for (const entry of this.active.values()) entry.controller.abort();
    await this.drain();
  }
  async run(signal: AbortSignal) {
    const stop = () => { void this.stop(); };
    signal.addEventListener("abort", stop, { once: true });
    try {
      let lastRecovery = 0;
      while (!signal.aborted && !this.stopping) {
        if (this.options.verifyInterruptedExecutionStopped && Date.now() - lastRecovery >= Math.min(1_000, this.store.limits.leaseMs)) {
          await this.store.recoverExpired(this.options.verifyInterruptedExecutionStopped);
          lastRecovery = Date.now();
        }
        this.tick();
        await delay(this.options.pollMs ?? 250, undefined, { signal }).catch(() => {});
      }
    } finally { signal.removeEventListener("abort", stop); await this.stop(); }
  }
}
