/** Validate analysis.json files + both manifests against the @unfold/core zod schemas.
 *  bun src/validate.ts [analysis.json ...] */
import { readFile } from "node:fs/promises";
import { MediaAnalysis } from "../../../packages/core/src/schema.ts";
import { loadLibrary } from "./library.ts";

let failed = false;
for (const f of process.argv.slice(2)) {
  const r = MediaAnalysis.safeParse(JSON.parse(await readFile(f, "utf8")));
  if (r.success) console.log(`ok   MediaAnalysis  ${f}  (${r.data.words.length} words, ${r.data.scenes.length} scenes, ${r.data.frames.length} frames)`);
  else { failed = true; console.log(`FAIL MediaAnalysis  ${f}\n${r.error.message}`); }
}
try {
  const lib = await loadLibrary();
  const ids = new Set<string>();
  for (const x of [...lib.music, ...lib.sfx]) { if (ids.has(x.id)) throw new Error(`duplicate id ${x.id}`); ids.add(x.id); }
  for (const t of lib.music) if (t.beats.length < 16 || t.bpm < 60 || t.bpm > 180) throw new Error(`suspicious track ${t.id}`);
  console.log(`ok   MusicTrack[]   ${lib.music.length} tracks`);
  console.log(`ok   SfxItem[]      ${lib.sfx.length} sfx`);
} catch (e) { failed = true; console.log(`FAIL library: ${e instanceof Error ? e.message : e}`); }
process.exit(failed ? 1 : 0);
