/** Shared by the Node worker and web bridge. Do not import server-only or cookie-bound modules. */
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, open, readFile, readdir, realpath, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  HandlerFailure, JobFault, runIsolatedProcess,
  type HandlerContext, type JobContext, type JobHandler, type JobView, type RuntimeConfig,
} from "@unfold/jobs";
import type { EditPlan, MediaAnalysis } from "@unfold/core";
import type { RenderedQualityReview } from "../../../../packages/video/src/quality.ts";
import { PrivateStorage, StorageError, type Owner } from "./private-storage.ts";

export type RenderSnapshot = {
  version: 1; kind: "render"; clientFingerprint: string; planFingerprint: string;
  submittedInputFingerprint: string; renderedPlanFingerprint: string;
  settings: { resolution: "720p" | "1080p"; burnCaptions: boolean };
  plan: EditPlan; analysis: MediaAnalysis;
};
export type ReadyPayload = {
  url: string; review?: RenderedQualityReview; reviewUrl?: string; contactSheetUrl?: string; reviewError?: string;
  submittedInputFingerprint: string; renderedPlanFingerprint: string;
  settings: { resolution: "720p" | "1080p"; burnCaptions: boolean };
};
export type AnalysisPayload = { analysis: MediaAnalysis; projectId: string; timings?: Record<string, number>; cached?: boolean };
type ResultManifest = { version: 1; jobId: string; projectId: string; kind: "analysis" | "render"; value: AnalysisPayload | ReadyPayload };
const REVIEW_UNAVAILABLE = "The MP4 is ready, but its automatic review is incomplete. Inspect it before posting.";
export function isStorageFailure(error: unknown): error is StorageError {
  return error instanceof StorageError || Boolean(error && typeof error === "object" && ["StorageError", "RevisionConflict"].includes(error.constructor.name) && Number.isInteger((error as StorageError).status));
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => [key, canonical(v)]));
  return value;
}
export const contentFingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export function applicationStorage(config: RuntimeConfig, dataDir = process.env.UNFOLD_DATA_DIR ?? path.join(config.repoRoot, "data")) { return new PrivateStorage(path.join(dataDir, "private-v1")); }

export async function atomicJobFile(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, file); const directory = await open(path.dirname(file), "r"); try { await directory.sync(); } finally { await directory.close(); } }
  finally { await rm(temporary, { force: true }); }
}
async function syncPath(file: string) { const handle = await open(file, "r"); try { await handle.sync(); } finally { await handle.close(); } }
async function durableCopy(source: string, target: string) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try { await cp(source, temporary); await syncPath(temporary); await rename(temporary, target); await syncPath(path.dirname(target)); }
  finally { await rm(temporary, { force: true }); }
}
async function syncTree(directory: string): Promise<void> {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new HandlerFailure("INVALID_ARTIFACT", "The media result contains an unsupported resource.");
    if (item.isDirectory()) await syncTree(file); else if (item.isFile()) await syncPath(file);
  }
  await syncPath(directory);
}
export async function ownedAnalysis(storage: PrivateStorage, owner: Owner, videoId: string): Promise<MediaAnalysis | null> {
  const { asset, mediaDir } = await storage.assetPaths(owner, videoId);
  if (asset.status !== "analyzed") return null;
  const value = JSON.parse(await readFile(path.join(mediaDir, asset.assetId, "analysis.json"), "utf8")) as MediaAnalysis;
  if (value.videoId !== videoId || !value.src.startsWith(`/media/${asset.projectId}/${videoId}/`) || value.src.includes("?") || value.src.includes("#")) throw new StorageError(409, "Source analysis is unavailable.");
  return value;
}
export async function readJobResult(storage: PrivateStorage, owner: Owner, projectId: string, job: JobView): Promise<AnalysisPayload | ReadyPayload> {
  if (job.state !== "succeeded" || !job.output) throw new JobFault("RESULT_NOT_READY", "The job has not succeeded.", 409);
  if (job.output.id !== job.id || job.output.kind !== (job.kind === "analysis" ? "analysis" : "video")) throw new JobFault("INVALID_RESULT", "Job output is unavailable.", 409);
  const file = await storage.mediaPath(owner, [projectId, "exports", `${job.id}.json`]);
  const manifest = JSON.parse(await readFile(file, "utf8")) as ResultManifest;
  if (manifest.version !== 1 || manifest.jobId !== job.id || manifest.projectId !== projectId || manifest.kind !== job.kind) throw new JobFault("INVALID_RESULT", "Job output is unavailable.", 409);
  if (job.kind === "render") {
    const ready = manifest.value as ReadyPayload;
    if (!ready || typeof ready.url !== "string") throw new JobFault("INVALID_RESULT", "Job output is unavailable.", 409);
    for (const url of [ready.url, ready.reviewUrl, ready.contactSheetUrl].filter((v): v is string => Boolean(v))) {
      if (!url.startsWith(`/media/${projectId}/exports/`) || url.includes("?") || url.includes("#")) throw new JobFault("INVALID_RESULT", "Job output is unavailable.", 409);
      await storage.mediaPath(owner, url.slice(7).split("/"));
    }
  }
  return manifest.value;
}

export type ChildExecution = (ctx: HandlerContext, request: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type ApplicationBindingOptions = { storage?: PrivateStorage; origin?: string; executeChild?: ChildExecution };
export function createApplicationHandlers(config: RuntimeConfig, options: ApplicationBindingOptions = {}): Record<"analysis" | "render", JobHandler> {
  const storage = options.storage ?? applicationStorage(config);
  const origin = new URL(options.origin ?? process.env.UNFOLD_INTERNAL_ORIGIN ?? "http://127.0.0.1:3002");
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new JobFault("INVALID_CONFIG", "Configure a trusted internal web origin.");
  const executeChild: ChildExecution = options.executeChild ?? (async (ctx, request) => {
    const executionFile = path.join(ctx.workspace, "execution.json"), resultFile = path.join(ctx.workspace, "result.json");
    await writeFile(executionFile, JSON.stringify(request), { mode: 0o600 });
    try {
      await runIsolatedProcess({ command: config.bunExecutable, args: [path.join(config.repoRoot, "services/jobs/scripts/media-child.ts"), executionFile, resultFile], cwd: config.repoRoot, signal: ctx.signal,
        record: { file: path.join(ctx.workspace, "process.json"), token: ctx.job.lease.token, workerId: ctx.job.lease.workerId },
        onLine: (line) => {
          if (line.startsWith("UNFOLD_JOB_PROGRESS ")) ctx.progress({ fraction: Number(line.slice(20)), stage: "rendering" });
          if (line === "UNFOLD_JOB_STAGE reviewing") ctx.progress({ fraction: 0.9, stage: "reviewing" });
        } });
      ctx.signal.throwIfAborted();
      return JSON.parse(await readFile(resultFile, "utf8"));
    } finally { await rm(executionFile, { force: true }); await rm(resultFile, { force: true }); }
  });
  const scoped = (work: (ctx: HandlerContext, owner: Owner) => Promise<{ output: { kind: "analysis" | "video"; id: string } }>): JobHandler => async (ctx) => {
    const owner = { id: ctx.ownerId };
    await storage.getProject(owner, ctx.projectId);
    await storage.registerReference(owner, ctx.projectId, "jobs", ctx.job.id);
    const release = await storage.acquireLease(owner, ctx.projectId, `job-${ctx.job.kind}`);
    try {
      const disk = await statfs(ctx.workspace);
      if (disk.bavail * disk.bsize < config.minFreeBytes) throw new HandlerFailure("DISK_RESERVE", "There is not enough free storage to start this job.");
      ctx.signal.throwIfAborted(); return await work(ctx, owner);
    } catch (error) {
      if (isStorageFailure(error)) throw new HandlerFailure(error.status === 404 ? "INPUT_UNAVAILABLE" : "STORAGE_CONFLICT", error.status === 404 ? "The requested project or media is unavailable." : "The project storage could not complete this operation.");
      throw error;
    } finally { await release(); }
  };
  const publishResult = async (ctx: HandlerContext, owner: Owner, value: AnalysisPayload | ReadyPayload) => {
    ctx.signal.throwIfAborted(); await storage.getProject(owner, ctx.projectId);
    const filename = `${ctx.job.id}.json`;
    const manifest: ResultManifest = { version: 1, jobId: ctx.job.id, projectId: ctx.projectId, kind: ctx.job.kind, value };
    await atomicJobFile(path.join(storage.projectDir(ctx.projectId), "media/exports", filename), manifest);
    await storage.registerReference(owner, ctx.projectId, "exports", filename);
    return { output: { kind: ctx.job.kind === "analysis" ? "analysis" as const : "video" as const, id: ctx.job.id } };
  };
  return {
    analysis: scoped(async (ctx, owner) => {
      const paths = await storage.assetPaths(owner, ctx.job.input.id);
      if (paths.asset.projectId !== ctx.projectId) throw new StorageError(404, "Not found.");
      // Reuse is decided by analyzeVideo's fingerprint/model/language/frame validation, never
      // solely by an asset status flag. Its fingerprint keeps the original upload path stable.
      const scratchMedia = path.join(ctx.workspace, "media");
      await mkdir(scratchMedia, { recursive: true, mode: 0o700 });
      await cp(path.join(paths.mediaDir, paths.asset.assetId), path.join(scratchMedia, paths.asset.assetId), { recursive: true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      ctx.signal.throwIfAborted();
      ctx.progress({ fraction: 0.05, stage: "analyzing" });
      const result = await executeChild(ctx, { kind: "analysis", repoRoot: config.repoRoot, inputPath: paths.upload, options: { videoId: paths.asset.assetId, mediaDir: scratchMedia, urlPrefix: paths.urlPrefix, reuseExisting: true } });
      const analysis = result.analysis as MediaAnalysis;
      if (!analysis || analysis.videoId !== paths.asset.assetId || !analysis.src.startsWith(`${paths.urlPrefix}/${paths.asset.assetId}/`)) throw new HandlerFailure("INVALID_ANALYSIS", "The source analysis could not be published.");
      ctx.signal.throwIfAborted(); ctx.progress({ fraction: 0.95, stage: "saving" });
      const staging = path.join(paths.mediaDir, `.job-${ctx.job.id}`), target = path.join(paths.mediaDir, paths.asset.assetId), backup = path.join(paths.mediaDir, `.previous-${ctx.job.id}`);
      await mkdir(paths.mediaDir, { recursive: true, mode: 0o700 }); await rm(staging, { recursive: true, force: true });
      await cp(path.join(ctx.workspace, "media", paths.asset.assetId), staging, { recursive: true });
      await syncTree(staging);
      // The manifest's analyzed status is the publication marker; incomplete sources stay unavailable.
      await storage.updateAsset(owner, ctx.projectId, paths.asset.assetId, { status: "uploaded" });
      await rename(target, backup).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      try { await rename(staging, target); } catch (error) { await rename(backup, target).catch(() => {}); throw error; }
      await syncPath(paths.mediaDir);
      await storage.updateAsset(owner, ctx.projectId, paths.asset.assetId, { status: "analyzed" });
      await rm(backup, { recursive: true, force: true });
      return publishResult(ctx, owner, { analysis, timings: result.timings as Record<string, number>, cached: result.cached === true, projectId: ctx.projectId });
    }),
    render: scoped(async (ctx, owner) => {
      const snapshot = await storage.getJobInput<RenderSnapshot>(owner, ctx.projectId, ctx.job.input.id, ctx.job.input.revision);
      if (snapshot.version !== 1 || snapshot.kind !== "render" || contentFingerprint(snapshot.plan) !== snapshot.planFingerprint || snapshot.renderedPlanFingerprint !== snapshot.planFingerprint) throw new HandlerFailure("INPUT_CHANGED", "The requested edit revision is unavailable.");
      const plan = snapshot.plan;
      const privatePaths = [...new Set([plan.source.src, ...(plan.supporting ?? []).map((asset) => asset.src)])];
      const resolved: Record<string, string> = {};
      for (const src of privatePaths) {
        if (!src.startsWith(`/media/${ctx.projectId}/`) || src.includes("?") || src.includes("#")) throw new HandlerFailure("INVALID_MEDIA", "The requested footage is unavailable.");
        resolved[src] = await storage.mediaPath(owner, src.slice(7).split("/"));
      }
      for (const src of [plan.music?.url, ...plan.sfx.map((sound) => sound.url)].filter((src): src is string => Boolean(src))) {
        if (!src.startsWith("/assets/") || src.includes("?") || src.includes("#")) throw new HandlerFailure("INVALID_AUDIO", "The selected audio asset is unavailable.");
        const file = await realpath(path.join(config.publicDir, src)); const root = await realpath(path.join(config.publicDir, "assets"));
        if (!file.startsWith(root + path.sep)) throw new HandlerFailure("INVALID_AUDIO", "The selected audio asset is unavailable.");
        resolved[src] = file;
      }
      const access = await storage.createRenderAccess(owner, ctx.projectId, privatePaths, Math.min(30 * 60_000, config.limits.maxRuntimeMs + 60_000));
      try {
        const decorate = (src: string) => { const url = new URL(src, origin); url.searchParams.set("render", access.token); return url.href; };
        const renderClone = { ...plan, source: { ...plan.source, src: decorate(plan.source.src) }, supporting: plan.supporting?.map((asset) => ({ ...asset, src: decorate(asset.src) })) };
        const outputPath = path.join(ctx.workspace, "export.mp4"), reviewDir = path.join(ctx.workspace, "review");
        const result = await executeChild(ctx, { kind: "render", repoRoot: config.repoRoot, plan: renderClone, outputPath,
          options: { publicDir: config.publicDir, assetBase: origin.origin, entryPoint: path.join(config.repoRoot, "packages/video/src/entry.ts"), browserExecutable: config.browserExecutable, concurrency: 2 },
          review: { plan, assets: resolved, options: { reviewDir, publicDir: config.publicDir, analysis: snapshot.analysis, maxSeconds: 120, ffmpegExecutable: config.ffmpeg, ffprobeExecutable: config.ffprobe } } });
        ctx.signal.throwIfAborted(); ctx.progress({ fraction: 0.99, stage: "saving" });
        const outDir = path.join(storage.projectDir(ctx.projectId), "media/exports"); await mkdir(outDir, { recursive: true, mode: 0o700 });
        const filename = `${ctx.job.id}.mp4`;
        if (!(await stat(outputPath)).isFile() || (await stat(outputPath)).size < 1) throw new HandlerFailure("OUTPUT_MISSING", "The renderer did not produce an export.");
        await durableCopy(outputPath, path.join(outDir, filename));
        await storage.registerReference(owner, ctx.projectId, "exports", filename);
        const ready: ReadyPayload = { url: `/media/${ctx.projectId}/exports/${filename}`, submittedInputFingerprint: snapshot.submittedInputFingerprint, renderedPlanFingerprint: snapshot.renderedPlanFingerprint, settings: snapshot.settings };
        try {
          const review = result.review as RenderedQualityReview | undefined;
          if (!review || review.planFingerprint !== snapshot.planFingerprint) throw new Error("Review unavailable.");
          const keys = [review.artifacts.report, review.artifacts.contactSheet, ...review.artifacts.frames.map((frame) => frame.file)].filter(Boolean);
          const reviewRoot = await realpath(reviewDir);
          for (const key of keys) {
            if (!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(json|png|jpg)$/.test(key)) throw new Error("Invalid review artifact.");
            const file = await realpath(path.join(reviewDir, key));
            if (!file.startsWith(reviewRoot + path.sep) || !(await stat(file)).isFile()) throw new Error("Review artifact unavailable.");
            const destination = path.join(outDir, ctx.job.id, key); await durableCopy(file, destination);
            await storage.registerReference(owner, ctx.projectId, "exports", `${ctx.job.id}/${key}`);
          }
          ready.review = review; ready.reviewUrl = `/media/${ctx.projectId}/exports/${ctx.job.id}/${review.artifacts.report}`;
          if (review.artifacts.contactSheet) ready.contactSheetUrl = `/media/${ctx.projectId}/exports/${ctx.job.id}/${review.artifacts.contactSheet}`;
        } catch { ctx.signal.throwIfAborted(); ready.reviewError = REVIEW_UNAVAILABLE; }
        return publishResult(ctx, owner, ready);
      } finally { await access.release(); }
    }),
  };
}
export async function createHandlers(config: RuntimeConfig) { return createApplicationHandlers(config); }
export async function authorizeInput(context: JobContext, input: { kind: string; id: string; revision?: string }) {
  // Used only by the explicit operator harness. The HTTP bridge independently authorizes inputs.
  const { loadJobConfig } = await import("@unfold/jobs");
  const storage = applicationStorage(loadJobConfig()); const owner = { id: context.ownerId };
  await storage.getProject(owner, context.projectId);
  if (input.kind === "plan") await storage.getJobInput(owner, context.projectId, input.id, input.revision);
  else if ((await storage.getAsset(owner, input.id)).projectId !== context.projectId) throw new StorageError(404, "Not found.");
}
