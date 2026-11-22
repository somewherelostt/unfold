import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sampleLibrary, MediaAnalysis, type AgentPlan, type EditPlan, type Library, type StyleProfile, type SupportingFootage } from "@unfold/core";
import { PrivateStorage, StorageError, type Owner } from "./private-storage";

export const REPO_ROOT = path.resolve(process.cwd(), "../..");
export const DATA_DIR = process.env.UNFOLD_DATA_DIR ?? path.join(REPO_ROOT, "data");
// Legacy ownerless directories are retained on disk and never adopted by a signed-in account.
export const MEDIA_DIR = path.join(DATA_DIR, "media");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const STORE_DIR = path.join(DATA_DIR, "store");
export const PUBLIC_DIR = path.join(process.cwd(), "public");
export const ASSETS_DIR = path.join(PUBLIC_DIR, "assets");
export const storage = new PrivateStorage(path.join(DATA_DIR, "private-v1"));

export type GenerationRequest = {
  version: 1; receivedBrief: string; requestedAspect?: "9:16" | "1:1" | "16:9";
  supportingAssetIds: string[]; styleId?: string; direction: string; createdAt: number;
};
export type StoredPlan = {
  editPlan: EditPlan; agentPlan: AgentPlan; videoId: string; projectId: string;
  createdAt: number; updatedAt: number; revision: number;
  generationRequest?: GenerationRequest;
};
export type StoredStyle = { profile: StyleProfile; sourceUrl: string | null; projectId: string };

export const store = {
  async putPlan(owner: Owner, projectId: string, plan: Omit<StoredPlan, "projectId" | "revision" | "updatedAt">) {
    const primary = await storage.getAsset(owner, plan.videoId);
    if (primary.projectId !== projectId || primary.role !== "primary") throw new StorageError(404, "Not found.");
    const value: StoredPlan = { ...plan, projectId, revision: 1, updatedAt: Date.now() };
    return storage.putRecord(owner, projectId, "plans", plan.editPlan.id, value);
  },
  async getPlan(owner: Owner, planId: string) {
    return (await storage.getRecord<StoredPlan>(owner, "plans", planId)).value;
  },
  async putStyle(owner: Owner, projectId: string, styleId: string, style: Omit<StoredStyle, "projectId">) {
    return storage.putRecord(owner, projectId, "styles", styleId, { ...style, projectId });
  },
  async getStyle(owner: Owner, styleId: string) {
    return (await storage.getRecord<StoredStyle>(owner, "styles", styleId)).value;
  },
};

export async function getAnalysis(owner: Owner, videoId: string): Promise<MediaAnalysis | null> {
  const { asset, mediaDir } = await storage.assetPaths(owner, videoId);
  if (asset.status !== "analyzed") return null;
  const raw = await readFile(path.join(mediaDir, asset.assetId, "analysis.json"), "utf8");
  const analysis = MediaAnalysis.parse(JSON.parse(raw));
  if (analysis.videoId !== asset.assetId || !analysis.src.startsWith(`/media/${asset.projectId}/${asset.assetId}/`)) throw new StorageError(409, "Stored media needs to be analyzed again.");
  return analysis;
}

export async function resolveSupporting(owner: Owner, projectId: string, ids: string[]): Promise<SupportingFootage[]> {
  if (ids.length > 4 || new Set(ids).size !== ids.length) throw new StorageError(400, "Choose up to four distinct supporting videos.");
  return Promise.all(ids.map(async (assetId) => {
    const asset = await storage.getAsset(owner, assetId);
    if (asset.projectId !== projectId || asset.role !== "supporting") throw new StorageError(404, "Not found.");
    const analysis = await getAnalysis(owner, assetId);
    if (!analysis) throw new StorageError(409, "Analyze supporting footage before using it.");
    return { name: asset.filename.slice(0, 160), description: asset.description, analysis };
  }));
}

export function frameLoader(owner: Owner, projectId: string) {
  return async (url: string): Promise<string> => {
    if (!url.startsWith(`/media/${projectId}/`) || url.includes("?") || url.includes("#")) throw new StorageError(404, "Not found.");
    const file = await storage.mediaPath(owner, url.slice("/media/".length).split("/"));
    if (!/\.(jpg|jpeg|png|webp)$/i.test(file)) throw new StorageError(400, "Invalid frame.");
    return `data:image/jpeg;base64,${(await readFile(file)).toString("base64")}`;
  };
}

let libraryCache: { at: number; lib: Library } | null = null;
export async function getLibrary(): Promise<Library> {
  if (libraryCache && Date.now() - libraryCache.at < 60_000) return libraryCache.lib;
  let lib: Library = sampleLibrary;
  try {
    const { loadLibrary } = await import("@unfold/media");
    const real = await loadLibrary(ASSETS_DIR);
    if (real.music.length && real.sfx.length) lib = real;
  } catch { /* Library manifests may not be installed in a local demo. */ }
  libraryCache = { at: Date.now(), lib };
  return lib;
}
