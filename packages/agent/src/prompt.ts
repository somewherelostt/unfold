import type { Library, MediaAnalysis, StyleProfile, AgentPlan } from "@unfold/core";

/** JSON shape the model must return (kept short: it's sent with every request). */
export const AGENT_PLAN_SHAPE = `{
  "title": string (2-3 words, e.g. "Chaos cut"),
  "style": "gaming-montage"|"podcast-clip"|"storytime"|"chaos"|"custom",
  "rationale": string (one sentence),
  "aspect": "9:16"|"1:1"|"16:9",
  "hookText": string|null (max 6 words, on screen for the first 2s),
  "segments": [{"srcStart": number, "srcEnd": number, "speed": number 0.5-2}],
  "captions": {"enabled": boolean, "preset": "bold-pop"|"clean-pop"|"meme"|"story"|"karaoke", "wordsPerChunk": 1-5, "position": "upper"|"center"|"lower", "uppercase": boolean, "highlightColor": "#RRGGBB", "emphasisWords": [string], "design"?: {"typeface": "sans"|"serif"|"condensed"|"rounded", "fontScale": 0.65-1.3, "weight": "regular"|"medium"|"bold", "textColor": "#RRGGBB", "highlightMode": "none"|"word"|"background", "animation": "none"|"fade"|"rise"|"pop", "outline": boolean}},
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
    `REFERENCE STYLE (adapt its techniques to this footage and brief): ${p.summary}`,
    `- pacing: ${r1(p.cutsPerMinute)} cuts/min, avg shot ${r1(p.avgShotSec)}s`,
    `- captions: ${p.captions.preset}, ${p.captions.wordsPerChunk} words/chunk, ${p.captions.position}, ${p.captions.uppercase ? "UPPERCASE" : "sentence case"}, highlight ${p.captions.highlightColor}`,
    `- transitions: ${p.transitions.join(", ")}; zoom intensity ${r1(p.zoomIntensity)}; SFX ${r1(p.sfxDensityPerMin)}/min`,
    `- music energy ${r1(p.musicEnergy)}, moods ${p.musicMoods.join(", ")}`,
  ].join("\n");
}

export const ADAPTIVE_DIRECTION = "Adaptive edit: infer whether this is a product demonstration, testimonial, explanation, personal story or action clip. Follow the creator's brief and available evidence. Preserve a clear setup, meaningful proof or action, and a satisfying outcome. Leave music, SFX, transitions, zooms and hook text out when they do not help.";

const EDITORIAL_RULES = `Editorial priorities:
- The creator's brief takes priority over optional variant suggestions. Adapt reference techniques to this footage; do not copy its claims, words or unrelated visuals.
- Identify the story before decorating it. For product content, use a relevant problem, actual demonstration or proof, and an honest benefit; add a call to action only if requested or present in the footage. For organic content, preserve the creator's voice, setup, reaction and payoff. Never invent claims or outcomes.
- Keep complete spoken thoughts and useful pauses. Default speech speed is 1. Do not force cuts onto every music beat or sacrifice a sentence for a beat.
- Captions transcribe the supplied speech. Start with readable sentence-case phrases in a safe area; use bold animations and frequent word emphasis only when the brief or footage warrants them. Do not cover the subject or product.
- Music is optional: return null when silence or original sound works better. If useful, start with a quiet instrumental bed under dialogue (about 0.08-0.16 volume), matched to the mood. Volume is a gain setting, not a loudness guarantee. Beat snapping is optional and defaults off.
- Effects need a visible or audible reason. Prefer clean cuts; empty transitions, zooms, sfx and overlays arrays are valid. Never meet an effect quota. Keep sound effects sparse and below important speech. Do not add a hook title if the opening already communicates it.
- Place every cue at an observed source moment that remains in the edit. Use only the supplied footage and library asset IDs. An inspiration video is not an available source asset. External B-roll is not supported by this plan shape; do not invent footage or asset IDs.
- In rationale, explain the story choice and the restraint or emphasis that makes it fit this clip. Before replying, check continuity, unbroken speech, truthful captions, justified cues and whether an element should be removed.`;

/** Alternatives explore storytelling choices without imposing an effect package. */
export const VARIANT_DIRECTIONS = [
  ADAPTIVE_DIRECTION,
  "Alternative opening: try another strong, truthful opening already present in the footage. Preserve the intended meaning and context; retain the requested style.",
  "Tighter story: remove repetition while preserving the setup, proof and payoff. Use quieter styling when it improves clarity.",
  "Proof first: where relevant, lead with an actual result or demonstration, then supply the necessary context. Do not invent evidence or a product claim.",
  "More breathing room: preserve authentic reactions, useful pauses and natural sound. Keep only effects that help the story.",
  "Dialogue led: prioritize a complete, memorable spoken idea and readable captions. Supporting audio and visuals remain optional.",
  "Action led: when action is the subject, emphasize its strongest observed sequence. Use energetic timing only if it fits the brief and available footage.",
  "Visual detail: use meaningful details already visible in the supplied footage. Preserve continuity and do not invent B-roll.",
  "Alternative ending: try a different supported outcome, final reaction or requested call to action. Keep the edit's premise and style coherent.",
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
        "You are Unfold's editing agent. Make a coherent edit that fits the content, not a fixed effects template.\n" + EDITORIAL_RULES + "\nReply with exactly one JSON object matching this shape, nothing else:\n" + AGENT_PLAN_SHAPE,
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
    `CREATOR BRIEF: ${opts.brief || "Make a clear, engaging edit that feels natural for this footage."}`,
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
