import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  sampleAnalysis,
  sampleLibrary,
  MediaAnalysis,
  type AgentPlan,
  type EditPlan,
  type Library,
  type StyleProfile,
} from "@unfold/core";

/** Repo root: apps/web is the web app's cwd. */
export const REPO_ROOT = path.resolve(process.cwd(), "../..");
export const DATA_DIR = process.env.UNFOLD_DATA_DIR ?? path.join(REPO_ROOT, "data");
export const MEDIA_DIR = path.join(DATA_DIR, "media");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const STORE_DIR = path.join(DATA_DIR, "store");
export const PUBLIC_DIR = path.join(process.cwd(), "public");
export const ASSETS_DIR = path.join(PUBLIC_DIR, "assets");

const safeId = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("bad id");
  return id;
};

async function put(kind: string, id: string, value: unknown) {
  const dir = path.join(STORE_DIR, kind);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${safeId(id)}.json`), JSON.stringify(value));
}

async function get<T>(kind: string, id: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(STORE_DIR, kind, `${safeId(id)}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

export type StoredPlan = { editPlan: EditPlan; agentPlan: AgentPlan; videoId: string; createdAt: number };

export const store = {
  putPlan: (p: StoredPlan) => put("plans", p.editPlan.id, p),
  getPlan: (id: string) => get<StoredPlan>("plans", id),
  putStyle: (id: string, s: { profile: StyleProfile; sourceUrl: string | null }) => put("styles", id, s),
  getStyle: (id: string) => get<{ profile: StyleProfile; sourceUrl: string | null }>("styles", id),
};

/** Analysis written by services/media at data/media/<id>/analysis.json; "sample" = built-in demo. */
export async function getAnalysis(videoId: string): Promise<MediaAnalysis | null> {
  if (videoId === "sample") return sampleAnalysis;
  try {
    const raw = await readFile(path.join(MEDIA_DIR, safeId(videoId), "analysis.json"), "utf8");
    return MediaAnalysis.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

let libraryCache: { at: number; lib: Library } | null = null;

/** Music + SFX manifests from public/assets; falls back to the placeholder sample library. */
export async function getLibrary(): Promise<Library> {
  if (libraryCache && Date.now() - libraryCache.at < 60_000) return libraryCache.lib;
  let lib: Library = sampleLibrary;
  try {
    const { loadLibrary } = await import("@unfold/media");
    const real = await loadLibrary(ASSETS_DIR);
    if (real.music.length && real.sfx.length) lib = real;
  } catch {
    /* manifests not ready yet */
  }
  libraryCache = { at: Date.now(), lib };
  return lib;
}

/** Web path of a frame → base64 data URL for the model's image input. */
export async function loadFrame(url: string): Promise<string> {
  let file: string;
  if (url.startsWith("/media/")) file = path.join(MEDIA_DIR, url.slice("/media/".length));
  else file = path.join(PUBLIC_DIR, url);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(MEDIA_DIR)) && !resolved.startsWith(path.resolve(PUBLIC_DIR))) throw new Error("bad frame path");
  return `data:image/jpeg;base64,${(await readFile(resolved)).toString("base64")}`;
}
