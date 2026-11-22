/**
 * Server-only MP4 export. Import from "@unfold/video/render" (never from client code).
 * Plain TS with type-only imports so it also runs under Node's native type stripping.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  /** Defaults to two workers; pass null to use automatic concurrency. */
  concurrency?: number | null;
  crf?: number;
  /** Stop an in-flight export when its request is cancelled. */
  signal?: AbortSignal;
};

const COMPOSITION_ID = "UnfoldPlan";
const bundles = new Map<string, { fingerprint: string; promise: Promise<string> }>();

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
  return path.resolve(found);
}

function sourceFingerprint(entryPoint: string): string {
  let videoDir = path.dirname(entryPoint);
  while (!existsSync(path.join(videoDir, "package.json"))) {
    const parent = path.dirname(videoDir);
    if (parent === videoDir) {
      videoDir = path.dirname(entryPoint);
      break;
    }
    videoDir = parent;
  }
  const coreDir = path.resolve(videoDir, "../core");
  const workspaceDir = path.resolve(videoDir, "../..");
  const hash = createHash("sha256");
  const visited = new Set<string>();
  const add = (file: string) => {
    const absolute = path.resolve(file);
    if (visited.has(absolute)) return;
    visited.add(absolute);
    hash.update(absolute).update("\0");
    if (!existsSync(absolute)) {
      hash.update("missing\0");
    } else if (statSync(absolute).isDirectory()) {
      hash.update("directory\0");
      for (const child of readdirSync(absolute).sort()) {
        if (child !== "node_modules" && child !== ".git") add(path.join(absolute, child));
      }
    } else {
      const content = readFileSync(absolute);
      hash.update(String(content.length)).update(":").update(content).update("\0");
    }
  };
  // These workspace sources are imported by the composition entry, including its sample plans.
  add(path.join(videoDir, "src"));
  add(path.join(coreDir, "src"));
  add(entryPoint);
  for (const dir of [videoDir, coreDir]) {
    add(path.join(dir, "package.json"));
    add(path.join(dir, "tsconfig.json"));
  }
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) add(path.join(workspaceDir, file));
  return hash.digest("hex");
}

/** Reuse a bundle while its source content is unchanged, sharing concurrent build work. */
export function getServeUrl(opts: Pick<RenderPlanOptions, "publicDir" | "entryPoint">): Promise<string> {
  const entryPoint = findEntry(opts.entryPoint);
  const key = `${entryPoint}::${path.resolve(opts.publicDir)}`;
  const fingerprint = sourceFingerprint(entryPoint);
  const cached = bundles.get(key);
  if (cached?.fingerprint === fingerprint) return cached.promise;
  // The in-memory cache handles reuse; a fresh source revision must not restore stale disk-cache output.
  const promise = import("@remotion/bundler").then(({ bundle }) => bundle({ entryPoint, publicDir: path.resolve(opts.publicDir), enableCaching: false }));
  const next = { fingerprint, promise };
  bundles.set(key, next);
  promise.catch(() => {
    if (bundles.get(key) === next) bundles.delete(key);
  });
  return promise;
}

/** Render an EditPlan to an H.264 MP4 at `outPath`. Resolves to `outPath`. */
export async function renderPlan(plan: EditPlan, outPath: string, opts: RenderPlanOptions): Promise<string> {
  opts.signal?.throwIfAborted();
  const { renderMedia, selectComposition, makeCancelSignal } = await import("@remotion/renderer");
  opts.signal?.throwIfAborted();
  const { cancelSignal, cancel } = makeCancelSignal();
  opts.signal?.addEventListener("abort", cancel, { once: true });
  try {
    const serveUrl = await getServeUrl(opts);
    opts.signal?.throwIfAborted();
    const inputProps = { plan, assetBase: opts.assetBase };
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
    opts.signal?.throwIfAborted();
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      crf: opts.crf ?? 20,
      concurrency: opts.concurrency === undefined ? 2 : opts.concurrency,
      imageFormat: "jpeg",
      jpegQuality: 90,
      cancelSignal,
      onProgress: opts.onProgress ? ({ progress }) => opts.onProgress!(progress) : undefined,
    });
    opts.signal?.throwIfAborted();
    return outPath;
  } catch (error) {
    opts.signal?.throwIfAborted();
    throw error;
  } finally {
    opts.signal?.removeEventListener("abort", cancel);
  }
}
