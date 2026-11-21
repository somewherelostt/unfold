import type { Library, MediaAnalysis, StyleProfile, AgentPlan } from "@unfold/core";

/** JSON shape the model must return (kept short: it's sent with every request). */
export const AGENT_PLAN_SHAPE = `{
  "title": string (2-3 words, e.g. "Chaos cut"),
  "style": "gaming-montage"|"podcast-clip"|"storytime"|"chaos"|"custom",
  "rationale": string (one sentence),
  "aspect": "9:16"|"1:1"|"16:9",
  "hookText": string|null (max 6 words, on screen for the first 2s),
  "segments": [{"srcStart": number, "srcEnd": number, "speed": number 0.5-2}],
  "captions": {"enabled": boolean, "preset": "bold-pop"|"clean-pop"|"meme"|"story"|"karaoke", "wordsPerChunk": 1-5, "position": "upper"|"center"|"lower", "uppercase": boolean, "highlightColor": "#RRGGBB", "emphasisWords": [string]},
  "music": {"trackId": string, "volume": 0-1, "alignDropToSrc": number|null, "snapCutsToBeats": boolean} | null,
  "transitions": [{"afterSegment": int, "type": "cut"|"whip"|"zoom-punch"|"flash"|"shake"|"glitch"|"slide"}],
  "zooms": [{"srcTime": number, "kind": "punch"|"slow-push", "scale": 1-1.8}],
  "sfx": [{"srcTime": number, "sfxId": string, "volume": 0-1}],
  "overlays": [{"srcTime": number, "text": string, "durationSec": number}]
}`;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Compact, cache-friendly description of the clip. Identical for every variant so the prefix is cached. */
export function describeClip(a: MediaAnalysis): string {
  const words = a.words.map((w) => `${r1(w.start)} ${w.text}`).join(" | ");
  const scenes = a.scenes.map((s) => `${r1(s.start)}-${r1(s.end)}`).join(", ");
  const peaks = [...a.loudness]
    .sort((x, y) => y.db - x.db)
    .slice(0, 8)
    .map((l) => r1(l.t))
    .sort((x, y) => x - y)
    .join(", ");
  return [
    `CLIP: ${r1(a.durationSec)}s, ${a.width}x${a.height}, speech: ${a.hasSpeech ? "yes" : "no"}`,
    `SCENES (src seconds): ${scenes || "none detected"}`,
    `LOUDEST MOMENTS: ${peaks || "n/a"}`,
    a.hasSpeech ? `TRANSCRIPT (start-second word): ${words}` : "TRANSCRIPT: none (gameplay/no speech). Use frames, scenes and loudness to find moments.",
    `FRAMES: ${a.frames.length} images attached in time order at seconds ${a.frames.map((f) => r1(f.t)).join(", ")}`,
  ].join("\n");
}

export function describeLibrary(lib: Library): string {
  const music = lib.music
    .map((m) => `${m.id}: ${m.bpm}bpm, energy ${r1(m.energy)}, ${m.moods.join("/")}, ${m.genres.join("/")}${m.dropAt != null ? `, drop@${r1(m.dropAt)}s` : ""}`)
    .join("\n");
  const sfx = lib.sfx.map((s) => `${s.id}: ${s.tags.join("/")}`).join("\n");
  return `MUSIC LIBRARY (trackId: info):\n${music}\n\nSFX LIBRARY (sfxId: tags):\n${sfx}`;
}

export function describeStyle(p: StyleProfile): string {
  return [
    `COPY THIS STYLE (from the creator's inspiration video): ${p.summary}`,
    `- pacing: ${r1(p.cutsPerMinute)} cuts/min, avg shot ${r1(p.avgShotSec)}s`,
    `- captions: ${p.captions.preset}, ${p.captions.wordsPerChunk} words/chunk, ${p.captions.position}, ${p.captions.uppercase ? "UPPERCASE" : "sentence case"}, highlight ${p.captions.highlightColor}`,
    `- transitions: ${p.transitions.join(", ")}; zoom intensity ${r1(p.zoomIntensity)}; SFX ${r1(p.sfxDensityPerMin)}/min`,
    `- music energy ${r1(p.musicEnergy)}, moods ${p.musicMoods.join(", ")}`,
  ].join("\n");
}

/** Nine deliberately different directions for variants mode. */
export const VARIANT_DIRECTIONS = [
  "Chaos cut: cold-open on the wildest moment, very fast cuts on every beat, meme captions, 3-4 meme SFX, flash and shake transitions, high-energy track.",
  "Clean hook: strongest line first, clean-pop captions centered, whip transitions, one zoom punch per key line, trap or hype track at moderate volume.",
  "Storytime: chronological, story captions lower third, sentence case, slow pushes, chill or emotional track, at most 1 SFX.",
  "Gaming montage: bold-pop captions, zoom punches on action, glitch and whip transitions, phonk/hype track with the drop on the biggest moment.",
  "15-second teaser: only the single best moment plus a hook, ends on a cliffhanger, fast cuts, karaoke captions.",
  "Podcast clip: keep the best 2-3 sentences, karaoke captions, minimal transitions, subtle music, emphasis on the punchline.",
  "Meme edit: exaggerated reactions, record scratch or fail SFX on the twist, speed ramp (speed 1.3-1.5) on the setup, meme captions.",
  "Cinematic: slower pacing, slow-push zooms, epic or suspense track with the drop on the reveal, upper captions, few words per chunk.",
  "Hype reel: every cut on a downbeat, maximum energy, bold-pop uppercase captions in flare orange #FF5A1F, 2 boom/impact SFX.",
];

export type ImagePart = { type: "image_url"; image_url: { url: string } };
export type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | ({ type: "text"; text: string } | ImagePart)[] };

/** Shared prefix (system + clip + library + frames) — identical across variants for prompt caching. */
export function basePrefix(analysis: MediaAnalysis, library: Library, frameDataUrls: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are Unfold's editing agent. Reply with exactly one JSON object matching this shape, nothing else:\n" + AGENT_PLAN_SHAPE,
    },
    {
      role: "user",
      content: [
        { type: "text", text: describeClip(analysis) + "\n\n" + describeLibrary(library) },
        ...frameDataUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ],
    },
  ];
}

export function planRequest(opts: {
  analysis: MediaAnalysis;
  library: Library;
  frameDataUrls: string[];
  brief: string;
  direction?: string;
  style?: StyleProfile | null;
  aspect?: string;
}): ChatMessage[] {
  const parts = [
    `CREATOR BRIEF: ${opts.brief || "Make it go viral."}`,
    opts.style ? describeStyle(opts.style) : "",
    opts.direction ? `THIS VARIANT: ${opts.direction}` : "",
    `ASPECT: ${opts.aspect ?? "9:16"}`,
    "Return the AgentPlan JSON now.",
  ].filter(Boolean);
  return [...basePrefix(opts.analysis, opts.library, opts.frameDataUrls), { role: "user", content: parts.join("\n\n") }];
}

export function remixRequest(opts: {
  analysis: MediaAnalysis;
  library: Library;
  frameDataUrls: string[];
  current: AgentPlan;
  message: string;
}): ChatMessage[] {
  return [
    ...basePrefix(opts.analysis, opts.library, opts.frameDataUrls),
    { role: "assistant", content: JSON.stringify(opts.current) },
    {
      role: "user",
      content: `Change request: "${opts.message}". Apply it to the plan above, keep everything else that still fits, and return the full updated AgentPlan JSON.`,
    },
  ];
}

export function styleRequest(reference: MediaAnalysis, frameDataUrls: string[], stats: { cutsPerMinute: number; avgShotSec: number }): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        'You analyse short-form videos and describe their editing style. Reply with one JSON object only: {"summary": string, "cutsPerMinute": number, "avgShotSec": number, "captions": {"preset": "bold-pop"|"clean-pop"|"meme"|"story"|"karaoke", "wordsPerChunk": 1-5, "position": "upper"|"center"|"lower", "uppercase": boolean, "highlightColor": "#RRGGBB"}, "transitions": [types], "zoomIntensity": 0-1, "sfxDensityPerMin": number, "musicEnergy": 0-1, "musicMoods": [string]}',
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${describeClip(reference)}\nMEASURED: ${r1(stats.cutsPerMinute)} cuts/min, avg shot ${r1(stats.avgShotSec)}s.\nLook at the caption look, colours, zooms and transitions in the frames and describe the style.`,
        },
        ...frameDataUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ],
    },
  ];
}
