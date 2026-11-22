/** Identity comes from authenticated, project-authorized server context, never a request body. */
export type JobContext = Readonly<{ ownerId: string; projectId: string }>;
export type JobKind = "analysis" | "render" | "generation" | "remix" | "reference";
export type JobState = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export type InputReference = { kind: "upload" | "plan" | "snapshot"; id: string; revision?: string };
export type OutputReference = { kind: "analysis" | "video" | "task"; id: string; revision?: string };
export type JobProgress = { fraction: number; stage: string };
export type JobError = { code: string; message: string; transient: boolean };
/** Retry policy is chosen by the server. Never automatically retry charged generation. */
export type RetryPolicy = { maxAttempts: number; safeToRetry: boolean };
export type EnqueueRequest = {
  kind: JobKind;
  input: InputReference;
  idempotencyKey: string;
  retry?: RetryPolicy;
};
export type JobView = {
  id: string;
  kind: JobKind;
  state: JobState;
  input: InputReference;
  output: OutputReference | null;
  progress: JobProgress;
  attempt: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  availableAt: number;
  cancelRequestedAt: number | null;
  error: JobError | null;
  revision: number;
};
/** Internal worker data is deliberately absent from the client view. */
export type JobRecord = JobView & JobContext & {
  retry: RetryPolicy;
  lease: { token: string; workerId: string; expiresAt: number } | null;
};
export type Claim = JobRecord & { lease: NonNullable<JobRecord["lease"]> };
export type JobEvent = { id: number; event: "job"; data: JobView };
export type JobLimits = {
  maxQueued: number;
  maxOutstandingPerOwner: number;
  maxRunning: number;
  maxRunningPerOwner: number;
  maxRunningPerProject: number;
  maxRenders: number;
  maxAnalysis: number;
  leaseMs: number;
  retryBaseMs: number;
  maxRuntimeMs: number;
};
export const DEFAULT_LIMITS: JobLimits = {
  maxQueued: 32,
  maxOutstandingPerOwner: 4,
  maxRunning: 2,
  maxRunningPerOwner: 1,
  maxRunningPerProject: 1,
  maxRenders: 1,
  maxAnalysis: 1,
  leaseMs: 30_000,
  retryBaseMs: 2_000,
  maxRuntimeMs: 20 * 60_000,
};
export const isTerminal = (state: JobState) => state === "succeeded" || state === "failed" || state === "cancelled";
export class JobFault extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "JobFault";
    Object.defineProperty(this, Symbol.for("unfold.jobFault"), { value: true });
    this.code = code;
    this.status = status;
  }
}
/** Only this explicit error opts a known safe failure into bounded retry. */
export class HandlerFailure extends Error {
  readonly code: string;
  readonly transient: boolean;
  constructor(code: string, message: string, transient = false) {
    super(message);
    this.name = "HandlerFailure";
    Object.defineProperty(this, Symbol.for("unfold.handlerFailure"), { value: true });
    this.code = code;
    this.transient = transient;
  }
}
export const isJobFault = (error: unknown): error is JobFault => Boolean(error && typeof error === "object" && (error as Record<symbol, unknown>)[Symbol.for("unfold.jobFault")] === true);
export const isHandlerFailure = (error: unknown): error is HandlerFailure => Boolean(error && typeof error === "object" && (error as Record<symbol, unknown>)[Symbol.for("unfold.handlerFailure")] === true);
