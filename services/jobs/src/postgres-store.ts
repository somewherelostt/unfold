import { CloudDatabase } from "@unfold/cloud";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { DEFAULT_LIMITS, JobFault, isTerminal, type Claim, type EnqueueRequest, type JobContext, type JobError, type JobEvent, type JobKind, type JobLimits, type JobProgress, type JobRecord, type JobView, type OutputReference, } from "./types.ts";
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/;
const validId = (value: unknown) => typeof value === "string" && ID.test(value);
const copy = <T>(value: T): T => structuredClone(value);
const view = ({ ownerId: _o, projectId: _p, retry: _r, lease: _l, ...job }: JobRecord): JobView => copy(job);
const parse = (row?: Record<string, unknown>) => row ? JSON.parse(String(row.body)) as JobRecord : null;
function exactKeys(value: object, allowed: string[]) {
    if (Object.keys(value).some((key) => !allowed.includes(key)))
        throw new JobFault("INVALID_REQUEST", "Unexpected job settings.");
}
function validateContext(ctx: JobContext) {
    if (!ctx || typeof ctx.ownerId !== "string" || typeof ctx.projectId !== "string" || !CONTEXT_ID.test(ctx.ownerId) || !CONTEXT_ID.test(ctx.projectId))
        throw new JobFault("INVALID_CONTEXT", "Invalid execution context.");
}
export function validateEnqueueRequest(req: EnqueueRequest) {
    if (!req || typeof req !== "object")
        throw new JobFault("INVALID_REQUEST", "Invalid job request.");
    exactKeys(req, ["kind", "input", "idempotencyKey", "retry"]);
    if (!["analysis", "render", "generation", "remix", "reference"].includes(req.kind))
        throw new JobFault("INVALID_REQUEST", "Invalid job kind.");
    if (!req.input || typeof req.input !== "object")
        throw new JobFault("INVALID_REQUEST", "Missing input reference.");
    exactKeys(req.input, ["kind", "id", "revision"]);
    if (req.input.kind !== (req.kind === "analysis" ? "upload" : req.kind === "render" ? "plan" : "snapshot") || !validId(req.input.id))
        throw new JobFault("INVALID_REQUEST", "Invalid input reference.");
    if (req.kind !== "analysis" && !req.input.revision)
        throw new JobFault("INVALID_REQUEST", "Render jobs require an immutable plan revision.");
    if (req.input.revision !== undefined && (typeof req.input.revision !== "string" || !/^[A-Za-z0-9_.-]{1,160}$/.test(req.input.revision)))
        throw new JobFault("INVALID_REQUEST", "Invalid input revision.");
    if (typeof req.idempotencyKey !== "string" || !/^[A-Za-z0-9_.:-]{8,160}$/.test(req.idempotencyKey))
        throw new JobFault("INVALID_REQUEST", "An idempotency key of 8–160 safe characters is required.");
    if (req.retry !== undefined) {
        if (!req.retry || typeof req.retry !== "object" || Array.isArray(req.retry))
            throw new JobFault("INVALID_REQUEST", "Invalid retry policy.");
        exactKeys(req.retry, ["maxAttempts", "safeToRetry"]);
        if (!Number.isInteger(req.retry.maxAttempts) || req.retry.maxAttempts < 1 || req.retry.maxAttempts > 3 || typeof req.retry.safeToRetry !== "boolean")
            throw new JobFault("INVALID_REQUEST", "Invalid retry policy.");
        if (!req.retry.safeToRetry && req.retry.maxAttempts !== 1)
            throw new JobFault("INVALID_REQUEST", "Unsafe work cannot be automatically retried.");
    }
}
function validateOutput(job: JobRecord, output: OutputReference) {
    if (!output || typeof output !== "object")
        throw new JobFault("INVALID_OUTPUT", "Missing output reference.");
    exactKeys(output, ["kind", "id", "revision"]);
    if (output.kind !== (job.kind === "analysis" ? "analysis" : job.kind === "render" ? "video" : "task") || !validId(output.id) || (output.revision !== undefined && (typeof output.revision !== "string" || !/^[A-Za-z0-9_.-]{1,160}$/.test(output.revision))))
        throw new JobFault("INVALID_OUTPUT", "Invalid output reference.");
}
export type StoreOptions = {
    databasePath: string;
    artifactRoot: string;
    limits?: Partial<JobLimits>;
    now?: () => number;
};
export type FinishResult = {
    output: OutputReference;
    retainWorkspace?: boolean;
} | {
    error: JobError;
} | {
    cancelled: true;
};
/** PostgreSQL queue. Transaction-scoped advisory locks enforce the same global admission limits across hosts. */
export class PostgresJobStore {
    readonly limits: JobLimits;
    readonly artifactRoot: string;
    readonly databasePath: string;
    private readonly db: CloudDatabase;
    private readonly now: () => number;
    private closed = false;
    constructor(options: StoreOptions & {
        databaseUrl?: string;
    }) { this.databasePath = options.databasePath; this.artifactRoot = path.resolve(options.artifactRoot); this.now = options.now ?? Date.now; this.limits = { ...DEFAULT_LIMITS, ...options.limits }; for (const value of Object.values(this.limits))
        if (!Number.isSafeInteger(value) || value < 1)
            throw new JobFault("INVALID_CONFIG", "Job limits must be positive integers."); this.db = new CloudDatabase(options.databaseUrl); }
    async close() { if (!this.closed) {
        await this.db.close();
        this.closed = true;
    } }
    private tx<T>(fn: () => Promise<T>): Promise<T> { return this.db.transaction("media-jobs", fn); }
    private async read(id: string) { return parse(await this.db.get("SELECT body FROM jobs WHERE id=?", id)); }
    private async owned(ctx: JobContext, id: string) {
        validateContext(ctx);
        const job = parse(await this.db.get("SELECT body FROM jobs WHERE id=? AND owner_id=? AND project_id=?", id, ctx.ownerId, ctx.projectId));
        if (!job)
            throw new JobFault("NOT_FOUND", "Job not found.", 404);
        return job;
    }
    private async save(job: JobRecord) {
        job.updatedAt = this.now();
        const event = await this.db.run("INSERT INTO job_events(job_id,body) VALUES (?,?)", job.id, "{}");
        job.revision = Number(event.lastInsertRowid);
        await this.db.run("UPDATE jobs SET state=?,available_at=?,lease_expires_at=?,body=? WHERE id=?", job.state, job.availableAt, job.lease?.expiresAt ?? null, JSON.stringify(job), job.id);
        await this.db.run("UPDATE job_events SET body=? WHERE id=?", JSON.stringify(view(job)), job.revision);
        return copy(job);
    }
    private async count(sql: string, ...params: (string | number)[]) { return Number((await this.db.get(sql, ...params))?.n ?? 0); }
    async enqueue(ctx: JobContext, request: EnqueueRequest, options: {
        id?: string;
    } = {}): Promise<{
        job: JobView;
        created: boolean;
    }> {
        validateContext(ctx);
        validateEnqueueRequest(request);
        if (options.id !== undefined && !validId(options.id))
            throw new JobFault("INVALID_REQUEST", "Invalid server job identifier.");
        const retry = request.retry ?? { maxAttempts: 1, safeToRetry: false };
        const input = { kind: request.input.kind, id: request.input.id, ...(request.input.revision ? { revision: request.input.revision } : {}) };
        const hash = createHash("sha256").update(JSON.stringify({ kind: request.kind, input, retry: { maxAttempts: retry.maxAttempts, safeToRetry: retry.safeToRetry } })).digest("hex");
        return await this.tx(async () => {
            const prior = await this.db.get("SELECT body,request_hash FROM jobs WHERE owner_id=? AND project_id=? AND idempotency_key=?", ctx.ownerId, ctx.projectId, request.idempotencyKey);
            if (prior) {
                if (prior.request_hash !== hash)
                    throw new JobFault("IDEMPOTENCY_CONFLICT", "This idempotency key was used with different settings.", 409);
                return { job: view(parse(prior)!), created: false };
            }
            if (await this.count("SELECT count(*) n FROM jobs WHERE state='pending'") >= this.limits.maxQueued)
                throw new JobFault("QUEUE_FULL", "The queue is full. Try again later.", 429);
            if (await this.count("SELECT count(*) n FROM jobs WHERE owner_id=? AND state IN ('pending','running')", ctx.ownerId) >= this.limits.maxOutstandingPerOwner)
                throw new JobFault("OWNER_LIMIT", "Your job limit has been reached.", 429);
            const now = this.now();
            const job: JobRecord = {
                id: options.id ?? randomUUID(), ...ctx, kind: request.kind, state: "pending", input, output: null,
                retry: copy(retry), maxAttempts: retry.maxAttempts, attempt: 0,
                progress: { fraction: 0, stage: "queued" }, createdAt: now, updatedAt: now,
                startedAt: null, finishedAt: null, availableAt: now, cancelRequestedAt: null, error: null, revision: 0, lease: null,
            };
            await this.db.run("INSERT INTO jobs(id,owner_id,project_id,idempotency_key,request_hash,kind,state,available_at,body) VALUES (?,?,?,?,?,?,?,?,?)", job.id, ctx.ownerId, ctx.projectId, request.idempotencyKey, hash, job.kind, job.state, now, JSON.stringify(job));
            return { job: view(await this.save(job)), created: true };
        });
    }
    async get(ctx: JobContext, id: string): Promise<JobView> { return view(await this.owned(ctx, id)); }
    /** Server derives project context from an authenticated owner; never expose an unscoped ID lookup. */
    async getForOwner(ownerId: string, id: string): Promise<{
        context: JobContext;
        job: JobView;
    }> {
        if (typeof ownerId !== "string" || !CONTEXT_ID.test(ownerId))
            throw new JobFault("INVALID_CONTEXT", "Invalid execution context.");
        const job = parse(await this.db.get("SELECT body FROM jobs WHERE id=? AND owner_id=?", id, ownerId));
        if (!job)
            throw new JobFault("NOT_FOUND", "Job not found.", 404);
        return { context: { ownerId: job.ownerId, projectId: job.projectId }, job: view(job) };
    }
    async events(ctx: JobContext, id: string, after = 0, limit = 100): Promise<JobEvent[]> {
        await this.owned(ctx, id);
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500)
            throw new JobFault("INVALID_CURSOR", "Invalid event cursor.");
        return (await this.db.all("SELECT id,body FROM job_events WHERE job_id=? AND id>? ORDER BY id LIMIT ?", id, after, limit)).map((row) => ({ id: Number(row.id), event: "job", data: JSON.parse(String(row.body)) as JobView }));
    }
    async cancel(ctx: JobContext, id: string): Promise<JobView> {
        return await this.tx(async () => {
            const job = await this.owned(ctx, id);
            if (isTerminal(job.state) || job.cancelRequestedAt !== null)
                return view(job);
            job.cancelRequestedAt = this.now();
            if (job.state === "pending") {
                job.state = "cancelled";
                job.finishedAt = this.now();
                job.progress.stage = "cancelled";
            }
            else
                job.progress.stage = "cancelling";
            return view(await this.save(job));
        });
    }
    /** Trusted account teardown; status/HTTP entry points must never expose owner-wide access. */
    async cancelOwner(ownerId: string): Promise<number> {
        if (typeof ownerId !== "string" || !CONTEXT_ID.test(ownerId))
            throw new JobFault("INVALID_CONTEXT", "Invalid execution context.");
        return await this.tx(async () => {
            const jobs = (await this.db.all("SELECT body FROM jobs WHERE owner_id=? AND state IN ('pending','running')", ownerId)).map((r) => parse(r)!);
            for (const job of jobs) {
                if (job.cancelRequestedAt !== null)
                    continue;
                job.cancelRequestedAt = this.now();
                job.progress.stage = job.state === "pending" ? "cancelled" : "cancelling";
                if (job.state === "pending") {
                    job.state = "cancelled";
                    job.finishedAt = this.now();
                }
                await this.save(job);
            }
            return jobs.length;
        });
    }
    async ownerHasLiveWork(ownerId: string) { return await this.count("SELECT count(*) n FROM jobs WHERE owner_id=? AND state IN ('pending','running')", ownerId) > 0; }
    async claim(workerId: string, kinds: JobKind[] = ["analysis", "render"]): Promise<Claim | null> {
        if (!validId(workerId) || !kinds.length || kinds.some((k) => !["analysis", "render", "generation", "remix", "reference"].includes(k)))
            throw new JobFault("INVALID_WORKER", "Invalid worker settings.");
        return await this.tx(async () => {
            if (await this.count("SELECT count(*) n FROM jobs WHERE state='running'") >= this.limits.maxRunning)
                return null;
            const candidates = await this.db.all("SELECT body FROM jobs WHERE state='pending' AND available_at<=? ORDER BY available_at,id", this.now());
            for (const row of candidates) {
                const job = parse(row)!;
                if (!kinds.includes(job.kind))
                    continue;
                if (await this.count("SELECT count(*) n FROM jobs WHERE state='running' AND owner_id=?", job.ownerId) >= this.limits.maxRunningPerOwner)
                    continue;
                if (await this.count("SELECT count(*) n FROM jobs WHERE state='running' AND owner_id=? AND project_id=?", job.ownerId, job.projectId) >= this.limits.maxRunningPerProject)
                    continue;
                if (await this.count("SELECT count(*) n FROM jobs WHERE state='running' AND kind=?", job.kind) >= (job.kind === "render" ? this.limits.maxRenders : this.limits.maxAnalysis))
                    continue;
                job.state = "running";
                job.attempt++;
                job.startedAt ??= this.now();
                job.error = null;
                job.progress = { fraction: 0, stage: "starting" };
                job.lease = { token: randomUUID(), workerId, expiresAt: this.now() + this.limits.leaseMs };
                return await this.save(job) as Claim;
            }
            return null;
        });
    }
    private async matching(claim: Claim) {
        const job = await this.read(claim.id);
        if (!job || job.state !== "running" || job.lease?.token !== claim.lease.token || job.lease.workerId !== claim.lease.workerId)
            throw new JobFault("LEASE_LOST", "Execution lease is no longer held.", 409);
        return job;
    }
    async heartbeat(claim: Claim, progress?: JobProgress): Promise<{
        cancelRequested: boolean;
        runtimeExceeded: boolean;
    }> {
        return await this.tx(async () => {
            const job = await this.matching(claim);
            if (job.lease!.expiresAt <= this.now())
                throw new JobFault("LEASE_EXPIRED", "Execution lease expired.", 409);
            const runtimeExceeded = this.now() - (job.startedAt ?? this.now()) >= this.limits.maxRuntimeMs;
            job.lease!.expiresAt = this.now() + this.limits.leaseMs;
            if (progress && job.cancelRequestedAt === null) {
                if (!Number.isFinite(progress.fraction) || progress.fraction < 0 || progress.fraction > 1 || !/^[a-z][a-z0-9_-]{0,47}$/.test(progress.stage))
                    throw new JobFault("INVALID_PROGRESS", "Invalid job progress.");
                job.progress = { fraction: Math.max(job.progress.fraction, progress.fraction), stage: progress.stage };
            }
            // Heartbeats alone do not create thousands of duplicate transport events.
            if (progress)
                await this.save(job);
            else
                await this.db.run("UPDATE jobs SET lease_expires_at=?,body=? WHERE id=?", job.lease!.expiresAt, JSON.stringify(job), job.id);
            return { cancelRequested: job.cancelRequestedAt !== null, runtimeExceeded };
        });
    }
    /** Call only once the handler and all its child processes have stopped. Accepts expired own token. */
    async finish(claim: Claim, result: FinishResult): Promise<JobView> {
        return await this.tx(async () => await this.finishRecord(await this.matching(claim), result));
    }
    private async finishRecord(job: JobRecord, result: FinishResult): Promise<JobView> {
        if (job.cancelRequestedAt !== null || "cancelled" in result) {
            job.state = "cancelled";
            job.progress.stage = "cancelled";
        }
        else if ("output" in result && job.lease!.expiresAt > this.now()) {
            validateOutput(job, result.output);
            job.state = "succeeded";
            job.output = copy(result.output);
            job.progress = { fraction: 1, stage: "complete" };
            // The completion marker and fenced job success commit together. Prepared blobs
            // remain unavailable if the lease is lost, cancelled or the handler fails.
            if (job.kind === "analysis" || job.kind === "render")
                await this.db.run("UPDATE unfold.media_files SET completed=true WHERE project_id=? AND owner_id=? AND (relative_path=? OR relative_path=? OR starts_with(relative_path,?))", job.projectId, job.ownerId, 'media/exports/'+job.id+'.json', 'media/exports/'+job.id+'.mp4', 'media/exports/'+job.id+'/');
            if (result.retainWorkspace)
                await this.db.run("UPDATE job_resources SET referenced=1 WHERE job_id=? AND attempt=?", job.id, job.attempt);
        }
        else {
            const error: JobError = "error" in result ? result.error : { code: "LEASE_EXPIRED", message: "Execution stopped after its lease expired.", transient: true };
            if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) || typeof error.message !== "string" || error.message.length > 300 || typeof error.transient !== "boolean")
                throw new JobFault("INVALID_ERROR", "Invalid failure details.");
            job.error = copy(error);
            if (error.transient && job.retry.safeToRetry && job.attempt < job.retry.maxAttempts) {
                job.state = "pending";
                job.availableAt = this.now() + this.limits.retryBaseMs * 2 ** (job.attempt - 1);
                job.progress = { fraction: 0, stage: "retrying" };
            }
            else {
                job.state = "failed";
                job.progress.stage = "failed";
            }
        }
        job.lease = null;
        if (isTerminal(job.state))
            job.finishedAt = this.now();
        return view(await this.save(job));
    }
    async expiredClaims(): Promise<Claim[]> {
        return (await this.db.all("SELECT body FROM jobs WHERE state='running' AND lease_expires_at<=?", this.now())).map((r) => parse(r) as Claim);
    }
    /** No blind lease stealing: the supervisor must verify old execution and descendants are stopped. */
    async recoverExpired(verifyStopped: (claim: Claim) => Promise<boolean>): Promise<number> {
        let recovered = 0;
        for (const claim of await this.expiredClaims()) {
            if (!await verifyStopped(copy(claim)))
                continue;
            try {
                const changed = await this.tx(async () => {
                    const latest = await this.matching(claim);
                    if (latest.lease!.expiresAt > this.now())
                        return false;
                    await this.finishRecord(latest, { error: { code: "WORKER_INTERRUPTED", message: "The worker stopped before completing this job.", transient: true } });
                    return true;
                });
                if (changed)
                    recovered++;
            }
            catch (error) {
                if (!(error instanceof JobFault) || error.code !== "LEASE_LOST")
                    throw error;
            }
        }
        return recovered;
    }
    workspace(claim: Claim) { return path.join(this.artifactRoot, claim.id, `attempt-${claim.attempt}`); }
    async trackWorkspace(claim: Claim, retentionMs: number) {
        if (!Number.isSafeInteger(retentionMs) || retentionMs < 1)
            throw new JobFault("INVALID_CONFIG", "Invalid retention period.");
        await this.tx(async () => {
            await this.matching(claim);
            await this.db.run("INSERT OR IGNORE INTO job_resources(job_id,attempt,relative_path,expires_at) VALUES (?,?,?,?)", claim.id, claim.attempt, path.relative(this.artifactRoot, this.workspace(claim)), this.now() + retentionMs);
        });
    }
    async releaseOutput(ctx: JobContext, id: string) {
        await this.tx(async () => {
            const job = await this.owned(ctx, id);
            if (!isTerminal(job.state))
                throw new JobFault("JOB_ACTIVE", "Wait for the job to stop before releasing its output.", 409);
            await this.db.run("UPDATE job_resources SET referenced=0 WHERE job_id=?", id);
        });
    }
    /** Internal retention candidates; paths can only originate from workspace(), never user media. */
    async retentionCandidates(): Promise<{
        jobId: string;
        attempt: number;
        relativePath: string;
    }[]> {
        return (await this.db.all("SELECT r.job_id,r.attempt,r.relative_path FROM job_resources r JOIN jobs j ON j.id=r.job_id WHERE r.expires_at<=? AND r.referenced=0 AND j.state IN ('succeeded','failed','cancelled')", this.now())).map((r) => ({ jobId: String(r.job_id), attempt: Number(r.attempt), relativePath: String(r.relative_path) }));
    }
    async forgetResource(jobId: string, attempt: number) { await this.db.run("DELETE FROM job_resources WHERE job_id=? AND attempt=? AND referenced=0", jobId, attempt); }
    async workerSeen(id: string) {
        if (!validId(id))
            throw new JobFault("INVALID_WORKER", "Invalid worker ID.");
        await this.db.run("INSERT INTO worker_heartbeats(id,seen_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at", id, this.now());
    }
    async health() {
        const result = (await this.db.get("SELECT 1 ok"))?.ok === 1 ? "ok" : "unknown";
        const latest = (await this.db.get("SELECT max(seen_at) seen_at FROM worker_heartbeats"))?.seen_at;
        const overdueJobs = await this.count("SELECT count(*) n FROM jobs WHERE state='running' AND (body::jsonb->>'startedAt')::bigint<=?", this.now() - this.limits.maxRuntimeMs);
        return { storage: result === "ok", latestWorkerAt: latest == null ? null : Number(latest), expiredLeases: (await this.expiredClaims()).length, overdueJobs };
    }
}
