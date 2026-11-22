#!/usr/bin/env bun
/**
 * unfold-media CLI
 *   bun src/cli.ts analyze <video> [--id <videoId>] [--out analysis.json]
 *   bun src/cli.ts reference <url|file> [--id <id>]
 *   bun src/cli.ts library            # validate manifests, print summary
 */
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { analyzeVideo } from "./analyze.ts";
import { analyzeReferenceFile, fetchReference } from "./reference.ts";
import { loadLibrary } from "./library.ts";
import type { SpeechLanguage } from "./util.ts";

const [cmd, target, ...rest] = process.argv.slice(2);
const flag = (n: string) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

function summary(a: any) {
  return {
    videoId: a.videoId, src: a.src, durationSec: a.durationSec, size: `${a.width}x${a.height}@${a.fps}`,
    hasSpeech: a.hasSpeech, words: a.words.length, firstWords: a.words.slice(0, 12).map((w: any) => w.text).join(" "),
    scenes: a.scenes.length, frames: a.frames.length, loudness: a.loudness.length,
  };
}

async function main() {
  const language = flag("language") as SpeechLanguage | undefined;
  if (cmd === "analyze" && target) {
    const r = await analyzeVideo(target, { videoId: flag("id"), language });
    if (flag("out")) await writeFile(flag("out")!, JSON.stringify(r.analysis, null, 1));
    console.log(JSON.stringify({ ...summary(r.analysis), proxy: r.proxyMode, timingsMs: r.timings, dir: r.dir }, null, 1));
  } else if (cmd === "reference" && target) {
    const r = existsSync(target)
      ? await analyzeReferenceFile(target, { videoId: flag("id"), language })
      : await fetchReference(target, { videoId: flag("id"), language });
    console.log(JSON.stringify({ ...summary(r.analysis), title: r.title, stats: r.stats, timingsMs: r.timings }, null, 1));
  } else if (cmd === "library") {
    const lib = await loadLibrary();
    const moods: Record<string, number> = {};
    for (const t of lib.music) for (const m of t.moods) moods[m] = (moods[m] ?? 0) + 1;
    const bpms = lib.music.map((t) => t.bpm);
    console.log(JSON.stringify({ music: lib.music.length, sfx: lib.sfx.length, bpmRange: [Math.min(...bpms), Math.max(...bpms)], moods }, null, 1));
  } else {
    console.error("usage: cli.ts analyze <video> [--id ID] [--out file] [--language en|hi|auto] | reference <url|file> [--id ID] [--language en|hi|auto] | library");
    process.exit(2);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
