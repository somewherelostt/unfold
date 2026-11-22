/** Attempt-local child: Bun resolves the existing TS workspace packages; Node owns durable SQLite. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [inputFile, resultFile] = process.argv.slice(2);
if (!inputFile || !resultFile) throw new Error("Expected execution and result files.");
const request = JSON.parse(await readFile(inputFile, "utf8"));
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
let result: unknown;
if (request.kind === "analysis") {
  const { analyzeVideo } = await import(pathToFileURL(path.join(request.repoRoot, "services/media/src/analyze.ts")).href);
  result = await analyzeVideo(request.inputPath, { ...request.options, signal: controller.signal });
} else if (request.kind === "render") {
  const { renderPlan } = await import(pathToFileURL(path.join(request.repoRoot, "packages/video/src/render.ts")).href);
  const output = await renderPlan(request.plan, request.outputPath, { ...request.options, signal: controller.signal, onProgress: (fraction: number) => process.stdout.write(`UNFOLD_JOB_PROGRESS ${fraction * 0.9}\n`) });
  let review: unknown; let reviewError: string | undefined;
  if (request.review) {
    try {
      const { reviewRenderedPlan } = await import(pathToFileURL(path.join(request.repoRoot, "packages/video/src/review.ts")).href);
      process.stdout.write("UNFOLD_JOB_STAGE reviewing\n");
      review = await reviewRenderedPlan(request.review.plan, { ...request.review.options, outputPath: output, signal: controller.signal, resolveAsset: (src: string) => request.review.assets[src] ?? null });
    } catch {
      controller.signal.throwIfAborted();
      reviewError = "The MP4 is ready, but its automatic review is incomplete. Inspect it before posting.";
    }
  }
  result = { path: output, review, reviewError };
} else throw new Error("Unknown media task.");
await writeFile(resultFile, JSON.stringify(result), { mode: 0o600 });
