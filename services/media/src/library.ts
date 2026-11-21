import { readFile } from "node:fs/promises";
import path from "node:path";
import { MusicTrack, SfxItem } from "../../../packages/core/src/schema.ts";
import { REPO_ROOT } from "./util.ts";

export interface Library {
  music: MusicTrack[];
  sfx: SfxItem[];
}

const ASSETS = path.join(REPO_ROOT, "apps/web/public/assets");

/** Load + validate the music and SFX manifests (apps/web/public/assets/{music,sfx}/manifest.json). */
export async function loadLibrary(assetsDir = ASSETS): Promise<Library> {
  const [m, s] = await Promise.all([
    readFile(path.join(assetsDir, "music/manifest.json"), "utf8"),
    readFile(path.join(assetsDir, "sfx/manifest.json"), "utf8"),
  ]);
  return { music: MusicTrack.array().parse(JSON.parse(m)), sfx: SfxItem.array().parse(JSON.parse(s)) };
}
