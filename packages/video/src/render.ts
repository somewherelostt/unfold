/**
 * Server-only MP4 export. Import from "@unfold/video/render" (never from client code).
 * Plain TS with type-only imports so it also runs under Node's native type stripping.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EditPlan } from "@unfold/core";

export type RenderPlanOptions = {
  /** Directory served as the renderer's public dir; plan URLs like "/demo/x.mp4" resolve inside it. */
  publicDir: string;
  /** Prefix for relative media URLs instead of the public dir (e.g. "http://localhost:3000"). */
  assetBase?: string;
  /** Override the renderer entry (packages/video/src/entry.ts) if auto-detection fails. */
  entryPoint?: string;
  onProgress?: (progress: number) => void;
  concurrency?: number | null;
  crf?: number;
};

const COMPOSITION_ID = "UnfoldPlan";
const bundles = new Map<string, Promise<string>>();

function findEntry(explicit?: string): string {
  const candidates = [
    explicit,
    (() => {
      try {
        return fileURLToPath(new URL("./entry.ts", import.meta.url));
      } catch {
        return undefined;
      }
    })(),
    path.resolve(process.cwd(), "packages/video/src/entry.ts"),
    path.resolve(process.cwd(), "../../packages/video/src/entry.ts"),
    path.resolve(process.cwd(), "../packages/video/src/entry.ts"),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`@unfold/video: renderer entry not found. Tried:\n${candidates.join("\n")}\nPass opts.entryPoint.`);
  return found;
}

/** Bundle once per (entry, publicDir) and reuse; the first call takes ~5–15s. */
export function getServeUrl(opts: Pick<RenderPlanOptions, "publicDir" | "entryPoint">): Promise<string> {
  const entryPoint = findEntry(opts.entryPoint);
  const key = `${entryPoint}::${path.resolve(opts.publicDir)}`;
  let p = bundles.get(key);
  if (!p) {
    p = import("@remotion/bundler").then(({ bundle }) => bundle({ entryPoint, publicDir: path.resolve(opts.publicDir) }));
    p.catch(() => bundles.delete(key));
    bundles.set(key, p);
  }
  return p;
}

/** Render an EditPlan to an H.264 MP4 at `outPath`. Resolves to `outPath`. */
export async function renderPlan(plan: EditPlan, outPath: string, opts: RenderPlanOptions): Promise<string> {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await getServeUrl(opts);
  const inputProps = { plan, assetBase: opts.assetBase };
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outPath,
    inputProps,
    crf: opts.crf ?? 20,
    concurrency: opts.concurrency ?? null,
    imageFormat: "jpeg",
    jpegQuality: 90,
    onProgress: opts.onProgress ? ({ progress }) => opts.onProgress!(progress) : undefined,
  });
  return outPath;
}
