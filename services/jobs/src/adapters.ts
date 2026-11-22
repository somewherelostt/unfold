import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIsolatedProcess } from "./process.ts";
import { HandlerFailure, type InputReference, type OutputReference } from "./types.ts";
import type { HandlerContext, JobHandler } from "./worker.ts";

/** Implement with the owner-bound private storage service; each resolver must recheck ownership. */
export type MediaJobBindings = {
  resolveUpload: (ctx: HandlerContext, reference: InputReference) => Promise<{ inputPath: string; videoId: string }>;
  resolvePlan: (ctx: HandlerContext, reference: InputReference) => Promise<{ plan: unknown; revision: string }>;
  /** Storage-only publish under the owner's lock. Tool subprocesses belong in the isolated task. */
  publishAnalysis: (ctx: HandlerContext, result: { analysis: unknown; dir: string; sourcePath: string; timings: Record<string, number> }) => Promise<{ output: OutputReference; retainWorkspace?: boolean }>;
  publishRender: (ctx: HandlerContext, result: { path: string }) => Promise<{ output: OutputReference; retainWorkspace?: boolean }>;
  /** Register the job reference and hold private storage's project lease until finally releases it. */
  withProjectLease: <T>(ctx: HandlerContext, execute: () => Promise<T>) => Promise<T>;
};
export type MediaJobRuntime = {
  repoRoot: string;
  bunExecutable: string;
  publicDir: string;
  /** Generated transiently per attempt: a file/project-scoped media capability, never saved in a job. */
  assetBaseFor: (ctx: HandlerContext) => Promise<string>;
  browserExecutable: string;
  renderConcurrency?: number;
  /** Private analyzed URLs are rebased by publishAnalysis before they are exposed to clients. */
  analysisUrlPrefix?: string;
};

export function createMediaJobHandlers(bindings: MediaJobBindings, runtime: MediaJobRuntime): Record<"analysis" | "render", JobHandler> {
  const concurrency = runtime.renderConcurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new HandlerFailure("INVALID_CONFIG", "Invalid renderer concurrency.");
  const execute = async (ctx: HandlerContext, request: unknown) => {
    const inputFile = path.join(ctx.workspace, "execution.json");
    const resultFile = path.join(ctx.workspace, "result.json");
    // Paths, plans and short-lived media capabilities are attempt-local, never durable queue payloads.
    await writeFile(inputFile, JSON.stringify(request), { mode: 0o600 });
    try { await runIsolatedProcess({
      command: runtime.bunExecutable,
      args: [fileURLToPath(new URL("../scripts/media-child.ts", import.meta.url)), inputFile, resultFile],
      cwd: runtime.repoRoot, signal: ctx.signal,
      record: { file: path.join(ctx.workspace, "process.json"), token: ctx.job.lease.token, workerId: ctx.job.lease.workerId },
      onLine: (line) => {
        if (!line.startsWith("UNFOLD_JOB_PROGRESS ")) return;
        const fraction = Number(line.slice("UNFOLD_JOB_PROGRESS ".length));
        if (Number.isFinite(fraction)) ctx.progress({ fraction, stage: "rendering" });
      },
    });
      ctx.signal.throwIfAborted();
      return JSON.parse(await readFile(resultFile, "utf8")) as Record<string, unknown>;
    } finally {
      // Short-lived capability URLs are destroyed immediately at the attempt boundary.
      await rm(inputFile, { force: true }); await rm(resultFile, { force: true });
    }
  };
  return {
    analysis: (ctx) => bindings.withProjectLease(ctx, async () => {
      const upload = await bindings.resolveUpload(ctx, ctx.job.input);
      ctx.signal.throwIfAborted();
      ctx.progress({ fraction: 0.05, stage: "analyzing" });
      const result = await execute(ctx, { kind: "analysis", repoRoot: runtime.repoRoot, inputPath: upload.inputPath, options: { videoId: upload.videoId, mediaDir: path.join(ctx.workspace, "media"), urlPrefix: runtime.analysisUrlPrefix ?? "/private-job-media" } });
      ctx.progress({ fraction: 0.95, stage: "saving" });
      return bindings.publishAnalysis(ctx, result as Parameters<MediaJobBindings["publishAnalysis"]>[1]);
    }),
    render: (ctx) => bindings.withProjectLease(ctx, async () => {
      const resolved = await bindings.resolvePlan(ctx, ctx.job.input);
      if (resolved.revision !== ctx.job.input.revision) throw new HandlerFailure("INPUT_CHANGED", "The requested edit revision is unavailable.");
      const outputPath = path.join(ctx.workspace, "export.mp4");
      const assetBase = await runtime.assetBaseFor(ctx);
      ctx.signal.throwIfAborted();
      await execute(ctx, { kind: "render", repoRoot: runtime.repoRoot, plan: resolved.plan, outputPath, options: { publicDir: runtime.publicDir, entryPoint: path.join(runtime.repoRoot, "packages/video/src/entry.ts"), assetBase, browserExecutable: runtime.browserExecutable, concurrency } });
      ctx.progress({ fraction: 1, stage: "saving" });
      return bindings.publishRender(ctx, { path: outputPath });
    }),
  };
}
