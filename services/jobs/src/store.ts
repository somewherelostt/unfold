/// <reference path="./sqlite.d.ts" />
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_LIMITS, JobFault, isTerminal,
  type Claim, type EnqueueRequest, type JobContext, type JobError, type JobEvent,
  type JobKind, type JobLimits, type JobProgress, type JobRecord, type JobView, type OutputReference,
} from "./types.ts";

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/;
const validId = (value: unknown) => typeof value === "string" && ID.test(value);
const copy = <T>(value: T): T => structuredClone(value);
const view = ({ ownerId: _o, projectId: _p, retry: _r, lease: _l, ...job }: JobRecord): JobView => copy(job);
const parse = (row?: Record<string, unknown>) => row ? JSON.parse(String(row.body)) as JobRecord : null;
function exactKeys(value: object, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new JobFault("INVALID_REQUEST", "Unexpected job settings.");
}
function validateContext(ctx: JobContext) {
  if (!ctx || typeof ctx.ownerId !== "string" || typeof ctx.projectId !== "string" || !CONTEXT_ID.test(ctx.ownerId) || !CONTEXT_ID.test(ctx.projectId)) throw new JobFault("INVALID_CONTEXT", "Invalid execution context.");
}
export function validateEnqueueRequest(req: EnqueueRequest) {
  if (!req || typeof req !== "object") throw new JobFault("INVALID_REQUEST", "Invalid job request.");
  exactKeys(req, ["kind", "input", "idempotencyKey", "retry"]);
  if (req.kind !== "analysis" && req.kind !== "render") throw new JobFault("INVALID_REQUEST", "Invalid job kind.");
  if (!req.input || typeof req.input !== "object") throw new JobFault("INVALID_REQUEST", "Missing input reference.");
  exactKeys(req.input, ["kind", "id", "revision"]);
  if (req.input.kind !== (req.kind === "analysis" ? "upload" : "plan") || !validId(req.input.id)) throw new JobFault("INVALID_REQUEST", "Invalid input reference.");
  if (req.kind === "render" && !req.input.revision) throw new JobFault("INVALID_REQUEST", "Render jobs require an immutable plan revision.");
  if (req.input.revision !== undefined && (typeof req.input.revision !== "string" || !/^[A-Za-z0-9_.-]{1,160}$/.test(req.input.revision))) throw new JobFault("INVALID_REQUEST", "Invalid input revision.");
  if (typeof req.idempotencyKey !== "string" || !/^[A-Za-z0-9_.:-]{8,160}$/.test(req.idempotencyKey)) throw new JobFault("INVALID_REQUEST", "An idempotency key of 8–160 safe characters is required.");
  if (req.retry !== undefined) {
    if (!req.retry || typeof req.retry !== "object" || Array.isArray(req.retry)) throw new JobFault("INVALID_REQUEST", "Invalid retry policy.");
    exactKeys(req.retry, ["maxAttempts", "safeToRetry"]);
    if (!Number.isInteger(req.retry.maxAttempts) || req.retry.maxAttempts < 1 || req.retry.maxAttempts > 3 || typeof req.retry.safeToRetry !== "boolean") throw new JobFault("INVALID_REQUEST", "Invalid retry policy.");
    if (!req.retry.safeToRetry && req.retry.maxAttempts !== 1) throw new JobFault("INVALID_REQUEST", "Unsafe work cannot be automatically retried.");
  }
}
function validateOutput(job: JobRecord, output: OutputReference) {
  if (!output || typeof output !== "object") throw new JobFault("INVALID_OUTPUT", "Missing output reference.");
  exactKeys(output, ["kind", "id", "revision"]);
  if (output.kind !== (job.kind === "analysis" ? "analysis" : "video") || !validId(output.id) || (output.revision !== undefined && (typeof output.revision !== "string" || !/^[A-Za-z0-9_.-]{1,160}$/.test(output.revision)))) throw new JobFault("INVALID_OUTPUT", "Invalid output reference.");
}

export type StoreOptions = { databasePath: string; artifactRoot: string; limits?: Partial<JobLimits>; now?: () => number };
export type FinishResult = { output: OutputReference; retainWorkspace?: boolean } | { error: JobError } | { cancelled: true };

/** Single-host SQLite on local persistent storage. All state transitions use BEGIN IMMEDIATE. */
export class JobStore {
  readonly limits: JobLimits;
  readonly artifactRoot: string;
  readonly databasePath: string;
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private closed = false;

  constructor(options: StoreOptions) {
    this.databasePath = path.resolve(options.databasePath);
    this.artifactRoot = path.resolve(options.artifactRoot);
    this.now = options.now ?? Date.now;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value < 1) throw new JobFault("INVALID_CONFIG", "Job limits must be positive integers.");
    mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version > 1) { this.db.close(); throw new JobFault("SCHEMA_TOO_NEW", "Job storage requires a newer worker.", 503); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, kind TEXT NOT NULL,
        state TEXT NOT NULL, available_at INTEGER NOT NULL, lease_expires_at INTEGER,
        body TEXT NOT NULL, UNIQUE(owner_id,project_id,idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(state,available_at);
      CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner_id,project_id,state);
      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS job_events_job ON job_events(job_id,id);
      CREATE TABLE IF NOT EXISTS job_resources (
        job_id TEXT NOT NULL REFERENCES jobs(id), attempt INTEGER NOT NULL,
        relative_path TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, referenced INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(job_id,attempt)
      );
      CREATE TABLE IF NOT EXISTS worker_heartbeats (id TEXT PRIMARY KEY, seen_at INTEGER NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private read(id: string) { return parse(this.db.prepare("SELECT body FROM jobs WHERE id=?").get(id)); }
  private owned(ctx: JobContext, id: string) {
    validateContext(ctx);
    const job = parse(this.db.prepare("SELECT body FROM jobs WHERE id=? AND owner_id=? AND project_id=?").get(id, ctx.ownerId, ctx.projectId));
    if (!job) throw new JobFault("NOT_FOUND", "Job not found.", 404);
    return job;
  }
  private save(job: JobRecord) {
    job.updatedAt = this.now();
    const event = this.db.prepare("INSERT INTO job_events(job_id,body) VALUES (?,?)").run(job.id, "{}");
    job.revision = Number(event.lastInsertRowid);
    this.db.prepare("UPDATE jobs SET state=?,available_at=?,lease_expires_at=?,body=? WHERE id=?")
      .run(job.state, job.availableAt, job.lease?.expiresAt ?? null, JSON.stringify(job), job.id);
    this.db.prepare("UPDATE job_events SET body=? WHERE id=?").run(JSON.stringify(view(job)), job.revision);
    return copy(job);
  }
  private count(sql: string, ...params: (string | number)[]) { return Number(this.db.prepare(sql).get(...params)?.n ?? 0); }

  enqueue(ctx: JobContext, request: EnqueueRequest, options: { id?: string } = {}): { job: JobView; created: boolean } {
    validateContext(ctx); validateEnqueueRequest(request);
    if (options.id !== undefined && !validId(options.id)) throw new JobFault("INVALID_REQUEST", "Invalid server job identifier.");
    const retry = request.retry ?? { maxAttempts: 1, safeToRetry: false };
    const input = { kind: request.input.kind, id: request.input.id, ...(request.input.revision ? { revision: request.input.revision } : {}) };
    const hash = createHash("sha256").update(JSON.stringify({ kind: request.kind, input, retry: { maxAttempts: retry.maxAttempts, safeToRetry: retry.safeToRetry } })).digest("hex");
    return this.tx(() => {
      const prior = this.db.prepare("SELECT body,request_hash FROM jobs WHERE owner_id=? AND project_id=? AND idempotency_key=?").get(ctx.ownerId, ctx.projectId, request.idempotencyKey);
      if (prior) {
        if (prior.request_hash !== hash) throw new JobFault("IDEMPOTENCY_CONFLICT", "This idempotency key was used with different settings.", 409);
        return { job: view(parse(prior)!), created: false };
      }
      if (this.count("SELECT count(*) n FROM jobs WHERE state='pending'") >= this.limits.maxQueued) throw new JobFault("QUEUE_FULL", "The queue is full. Try again later.", 429);
      if (this.count("SELECT count(*) n FROM jobs WHERE owner_id=? AND state IN ('pending','running')", ctx.ownerId) >= this.limits.maxOutstandingPerOwner) throw new JobFault("OWNER_LIMIT", "Your job limit has been reached.", 429);
      const now = this.now();
      const job: JobRecord = {
        id: options.id ?? randomUUID(), ...ctx, kind: request.kind, state: "pending", input, output: null,
        retry: copy(retry), maxAttempts: retry.maxAttempts, attempt: 0,
        progress: { fraction: 0, stage: "queued" }, createdAt: now, updatedAt: now,
        startedAt: null, finishedAt: null, availableAt: now, cancelRequestedAt: null, error: null, revision: 0, lease: null,
      };
      this.db.prepare("INSERT INTO jobs(id,owner_id,project_id,idempotency_key,request_hash,kind,state,available_at,body) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(job.id, ctx.ownerId, ctx.projectId, request.idempotencyKey, hash, job.kind, job.state, now, JSON.stringify(job));
      return { job: view(this.save(job)), created: true };
    });
  }
  get(ctx: JobContext, id: string): JobView { return view(this.owned(ctx, id)); }
  /** Server derives project context from an authenticated owner; never expose an unscoped ID lookup. */
  getForOwner(ownerId: string, id: string): { context: JobContext; job: JobView } {
    if (typeof ownerId !== "string" || !CONTEXT_ID.test(ownerId)) throw new JobFault("INVALID_CONTEXT", "Invalid execution context.");
    const job = parse(this.db.prepare("SELECT body FROM jobs WHERE id=? AND owner_id=?").get(id, ownerId));
    if (!job) throw new JobFault("NOT_FOUND", "Job not found.", 404);
    return { context: { ownerId: job.ownerId, projectId: job.projectId }, job: view(job) };
  }
  events(ctx: JobContext, id: string, after = 0, limit = 100): JobEvent[] {
    this.owned(ctx, id);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new JobFault("INVALID_CURSOR", "Invalid event cursor.");
    return this.db.prepare("SELECT id,body FROM job_events WHERE job_id=? AND id>? ORDER BY id LIMIT ?").all(id, after, limit)
      .map((row) => ({ id: Number(row.id), event: "job", data: JSON.parse(String(row.body)) as JobView }));
  }
  cancel(ctx: JobContext, id: string): JobView {
    return this.tx(() => {
      const job = this.owned(ctx, id);
      if (isTerminal(job.state) || job.cancelRequestedAt !== null) return view(job);
      job.cancelRequestedAt = this.now();
      if (job.state === "pending") { job.state = "cancelled"; job.finishedAt = this.now(); job.progress.stage = "cancelled"; }
      else job.progress.stage = "cancelling";
      return view(this.save(job));
    });
  }
  /** Trusted account teardown; status/HTTP entry points must never expose owner-wide access. */
  cancelOwner(ownerId: string): number {
    if (typeof ownerId !== "string" || !CONTEXT_ID.test(ownerId)) throw new JobFault("INVALID_CONTEXT", "Invalid execution context.");
    return this.tx(() => {
      const jobs = this.db.prepare("SELECT body FROM jobs WHERE owner_id=? AND state IN ('pending','running')").all(ownerId).map((r) => parse(r)!);
      for (const job of jobs) {
        if (job.cancelRequestedAt !== null) continue;
        job.cancelRequestedAt = this.now(); job.progress.stage = job.state === "pending" ? "cancelled" : "cancelling";
        if (job.state === "pending") { job.state = "cancelled"; job.finishedAt = this.now(); }
        this.save(job);
      }
      return jobs.length;
    });
  }
  ownerHasLiveWork(ownerId: string) { return this.count("SELECT count(*) n FROM jobs WHERE owner_id=? AND state IN ('pending','running')", ownerId) > 0; }

  claim(workerId: string, kinds: JobKind[] = ["analysis", "render"]): Claim | null {
    if (!validId(workerId) || !kinds.length || kinds.some((k) => k !== "analysis" && k !== "render")) throw new JobFault("INVALID_WORKER", "Invalid worker settings.");
    return this.tx(() => {
      if (this.count("SELECT count(*) n FROM jobs WHERE state='running'") >= this.limits.maxRunning) return null;
      const candidates = this.db.prepare("SELECT body FROM jobs WHERE state='pending' AND available_at<=? ORDER BY available_at,id").all(this.now());
      for (const row of candidates) {
        const job = parse(row)!;
        if (!kinds.includes(job.kind)) continue;
        if (this.count("SELECT count(*) n FROM jobs WHERE state='running' AND owner_id=?", job.ownerId) >= this.limits.maxRunningPerOwner) continue;
        if (this.count("SELECT count(*) n FROM jobs WHERE state='running' AND owner_id=? AND project_id=?", job.ownerId, job.projectId) >= this.limits.maxRunningPerProject) continue;
        if (this.count("SELECT count(*) n FROM jobs WHERE state='running' AND kind=?", job.kind) >= (job.kind === "render" ? this.limits.maxRenders : this.limits.maxAnalysis)) continue;
        job.state = "running"; job.attempt++; job.startedAt ??= this.now(); job.error = null;
        job.progress = { fraction: 0, stage: "starting" };
        job.lease = { token: randomUUID(), workerId, expiresAt: this.now() + this.limits.leaseMs };
        return this.save(job) as Claim;
      }
      return null;
    });
  }
  private matching(claim: Claim) {
    const job = this.read(claim.id);
    if (!job || job.state !== "running" || job.lease?.token !== claim.lease.token || job.lease.workerId !== claim.lease.workerId) throw new JobFault("LEASE_LOST", "Execution lease is no longer held.", 409);
    return job;
  }
  heartbeat(claim: Claim, progress?: JobProgress): { cancelRequested: boolean; runtimeExceeded: boolean } {
    return this.tx(() => {
      const job = this.matching(claim);
      if (job.lease!.expiresAt <= this.now()) throw new JobFault("LEASE_EXPIRED", "Execution lease expired.", 409);
      const runtimeExceeded = this.now() - (job.startedAt ?? this.now()) >= this.limits.maxRuntimeMs;
      job.lease!.expiresAt = this.now() + this.limits.leaseMs;
      if (progress && job.cancelRequestedAt === null) {
        if (!Number.isFinite(progress.fraction) || progress.fraction < 0 || progress.fraction > 1 || !/^[a-z][a-z0-9_-]{0,47}$/.test(progress.stage)) throw new JobFault("INVALID_PROGRESS", "Invalid job progress.");
        job.progress = { fraction: Math.max(job.progress.fraction, progress.fraction), stage: progress.stage };
      }
      // Heartbeats alone do not create thousands of duplicate transport events.
      if (progress) this.save(job);
      else this.db.prepare("UPDATE jobs SET lease_expires_at=?,body=? WHERE id=?").run(job.lease!.expiresAt, JSON.stringify(job), job.id);
      return { cancelRequested: job.cancelRequestedAt !== null, runtimeExceeded };
    });
  }
  /** Call only once the handler and all its child processes have stopped. Accepts expired own token. */
  finish(claim: Claim, result: FinishResult): JobView {
    return this.tx(() => this.finishRecord(this.matching(claim), result));
  }
  private finishRecord(job: JobRecord, result: FinishResult): JobView {
      if (job.cancelRequestedAt !== null || "cancelled" in result) {
        job.state = "cancelled"; job.progress.stage = "cancelled";
      } else if ("output" in result && job.lease!.expiresAt > this.now()) {
        validateOutput(job, result.output);
        job.state = "succeeded"; job.output = copy(result.output); job.progress = { fraction: 1, stage: "complete" };
        if (result.retainWorkspace) this.db.prepare("UPDATE job_resources SET referenced=1 WHERE job_id=? AND attempt=?").run(job.id, job.attempt);
      } else {
        const error: JobError = "error" in result ? result.error : { code: "LEASE_EXPIRED", message: "Execution stopped after its lease expired.", transient: true };
        if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) || typeof error.message !== "string" || error.message.length > 300 || typeof error.transient !== "boolean") throw new JobFault("INVALID_ERROR", "Invalid failure details.");
        job.error = copy(error);
        if (error.transient && job.retry.safeToRetry && job.attempt < job.retry.maxAttempts) {
          job.state = "pending"; job.availableAt = this.now() + this.limits.retryBaseMs * 2 ** (job.attempt - 1); job.progress = { fraction: 0, stage: "retrying" };
        } else { job.state = "failed"; job.progress.stage = "failed"; }
      }
      job.lease = null;
      if (isTerminal(job.state)) job.finishedAt = this.now();
      return view(this.save(job));
  }
  expiredClaims(): Claim[] {
    return this.db.prepare("SELECT body FROM jobs WHERE state='running' AND lease_expires_at<=?").all(this.now()).map((r) => parse(r) as Claim);
  }
  /** No blind lease stealing: the supervisor must verify old execution and descendants are stopped. */
  async recoverExpired(verifyStopped: (claim: Claim) => Promise<boolean>): Promise<number> {
    let recovered = 0;
    for (const claim of this.expiredClaims()) {
      if (!await verifyStopped(copy(claim))) continue;
      try {
        const changed = this.tx(() => {
          const latest = this.matching(claim);
          if (latest.lease!.expiresAt > this.now()) return false;
          this.finishRecord(latest, { error: { code: "WORKER_INTERRUPTED", message: "The worker stopped before completing this job.", transient: true } });
          return true;
        });
        if (changed) recovered++;
      } catch (error) { if (!(error instanceof JobFault) || error.code !== "LEASE_LOST") throw error; }
    }
    return recovered;
  }

  workspace(claim: Claim) { return path.join(this.artifactRoot, claim.id, `attempt-${claim.attempt}`); }
  trackWorkspace(claim: Claim, retentionMs: number) {
    if (!Number.isSafeInteger(retentionMs) || retentionMs < 1) throw new JobFault("INVALID_CONFIG", "Invalid retention period.");
    this.tx(() => {
      this.matching(claim);
      this.db.prepare("INSERT OR IGNORE INTO job_resources(job_id,attempt,relative_path,expires_at) VALUES (?,?,?,?)")
        .run(claim.id, claim.attempt, path.relative(this.artifactRoot, this.workspace(claim)), this.now() + retentionMs);
    });
  }
  releaseOutput(ctx: JobContext, id: string) {
    this.tx(() => {
      const job = this.owned(ctx, id);
      if (!isTerminal(job.state)) throw new JobFault("JOB_ACTIVE", "Wait for the job to stop before releasing its output.", 409);
      this.db.prepare("UPDATE job_resources SET referenced=0 WHERE job_id=?").run(id);
    });
  }
  /** Internal retention candidates; paths can only originate from workspace(), never user media. */
  retentionCandidates(): { jobId: string; attempt: number; relativePath: string }[] {
    return this.db.prepare("SELECT r.job_id,r.attempt,r.relative_path FROM job_resources r JOIN jobs j ON j.id=r.job_id WHERE r.expires_at<=? AND r.referenced=0 AND j.state IN ('succeeded','failed','cancelled')").all(this.now())
      .map((r) => ({ jobId: String(r.job_id), attempt: Number(r.attempt), relativePath: String(r.relative_path) }));
  }
  forgetResource(jobId: string, attempt: number) { this.db.prepare("DELETE FROM job_resources WHERE job_id=? AND attempt=? AND referenced=0").run(jobId, attempt); }
  workerSeen(id: string) {
    if (!validId(id)) throw new JobFault("INVALID_WORKER", "Invalid worker ID.");
    this.db.prepare("INSERT INTO worker_heartbeats(id,seen_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at").run(id, this.now());
  }
  health() {
    const result = String(this.db.prepare("PRAGMA quick_check").get()?.quick_check ?? "unknown");
    const latest = this.db.prepare("SELECT max(seen_at) seen_at FROM worker_heartbeats").get()?.seen_at;
    const overdueJobs = this.count("SELECT count(*) n FROM jobs WHERE state='running' AND json_extract(body,'$.startedAt')<=?", this.now() - this.limits.maxRuntimeMs);
    return { storage: result === "ok", latestWorkerAt: latest == null ? null : Number(latest), expiredLeases: this.expiredClaims().length, overdueJobs };
  }
}
