import { z } from "zod";

/**
 * Unfold data contract.
 *
 * Flow: MediaAnalysis (from services/media) + Library (music/sfx manifests)
 *   → AgentPlan (written by the OpenClaw agent on Kimi K3.1 Pro; source-time based, compact)
 *   → compileEditPlan() (deterministic: maps to output time, snaps to beats, builds caption chunks)
 *   → EditPlan (render-ready; consumed by the renderer in packages/video and by the editor UI).
 *
 * Conventions: all times are seconds (float). `src*` = time in the raw upload. Everything in
 * EditPlan is output-timeline time unless the field name starts with `src`.
 */

// ---------- Media analysis (services/media) ----------
export const Word = z.object({ text: z.string(), start: z.number(), end: z.number() });
export type Word = z.infer<typeof Word>;

export const Scene = z.object({ start: z.number(), end: z.number(), thumb: z.string().optional() });
export const Frame = z.object({ t: z.number(), url: z.string() });

export const MediaAnalysis = z.object({
  videoId: z.string(),
  src: z.string(), // URL the browser/renderer can load, e.g. /media/<id>/source.mp4
  durationSec: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  hasSpeech: z.boolean(),
  words: z.array(Word),
  scenes: z.array(Scene),
  frames: z.array(Frame), // sampled stills for the agent (image input)
  loudness: z.array(z.object({ t: z.number(), db: z.number() })).default([]), // ~4Hz envelope, for hype moments
});
export type MediaAnalysis = z.infer<typeof MediaAnalysis>;

// ---------- Asset library (assets/*/manifest.json) ----------
export const MusicTrack = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  url: z.string(), // served path, e.g. /assets/music/<id>.mp3
  durationSec: z.number(),
  bpm: z.number(),
  beats: z.array(z.number()), // beat times in seconds from track start
  downbeats: z.array(z.number()).default([]),
  dropAt: z.number().nullable().default(null), // biggest energy rise, good hook alignment
  moods: z.array(z.string()), // e.g. ["hype","dark","funny","chill","epic","emotional"]
  genres: z.array(z.string()),
  energy: z.number().min(0).max(1),
  source: z.string(), // e.g. "library"
  sourceUrl: z.string(),
});
export type MusicTrack = z.infer<typeof MusicTrack>;

export const SfxItem = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  durationSec: z.number(),
  tags: z.array(z.string()), // e.g. ["boom","impact","reveal"], ["whoosh","transition"], ["fail","sad"]
  source: z.string(),
  license: z.string(),
});
export type SfxItem = z.infer<typeof SfxItem>;

// ---------- Shared enums ----------
export const Aspect = z.enum(["9:16", "1:1", "16:9"]);
export type Aspect = z.infer<typeof Aspect>;

export const CaptionPreset = z.enum(["bold-pop", "clean-pop", "meme", "story", "karaoke"]);
export type CaptionPreset = z.infer<typeof CaptionPreset>;

export const CaptionDesign = z.object({
  typeface: z.enum(["sans", "serif", "condensed", "rounded"]).default("sans"),
  fontScale: z.number().min(0.65).max(1.3).default(1),
  weight: z.enum(["regular", "medium", "bold"]).default("medium"),
  textColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#FFFFFF"),
  highlightMode: z.enum(["none", "word", "background"]).default("word"),
  animation: z.enum(["none", "fade", "rise", "pop"]).default("fade"),
  outline: z.boolean().default(false),
});
export type CaptionDesign = z.infer<typeof CaptionDesign>;

export const TransitionType = z.enum(["cut", "whip", "zoom-punch", "flash", "shake", "glitch", "slide"]);
export type TransitionType = z.infer<typeof TransitionType>;

export const StylePreset = z.enum(["gaming-montage", "podcast-clip", "storytime", "chaos", "custom"]);
export type StylePreset = z.infer<typeof StylePreset>;

// ---------- Style profile (from an inspiration video) ----------
export const StyleProfile = z.object({
  summary: z.string(),
  cutsPerMinute: z.number(),
  avgShotSec: z.number(),
  captions: z.object({
    preset: CaptionPreset,
    wordsPerChunk: z.number().int().min(1).max(5),
    position: z.enum(["upper", "center", "lower"]),
    uppercase: z.boolean(),
    highlightColor: z.string(),
  }),
  transitions: z.array(TransitionType),
  zoomIntensity: z.number().min(0).max(1),
  sfxDensityPerMin: z.number(),
  musicEnergy: z.number().min(0).max(1),
  musicMoods: z.array(z.string()),
});
export type StyleProfile = z.infer<typeof StyleProfile>;

// ---------- AgentPlan: what Kimi writes (compact, source-time based) ----------
export const AgentPlan = z.object({
  title: z.string(), // short label shown on the variant card, e.g. "Chaos cut"
  style: StylePreset,
  rationale: z.string(), // one sentence, shown in the UI
  aspect: Aspect.default("9:16"),
  hookText: z.string().nullable().default(null), // big on-screen text in the first 2s
  segments: z
    .array(z.object({ srcStart: z.number(), srcEnd: z.number(), speed: z.number().min(0.5).max(2).default(1) }))
    .min(1), // kept ranges, in output order (may reorder for a cold-open hook)
  captions: z.object({
    enabled: z.boolean().default(true),
    preset: CaptionPreset,
    wordsPerChunk: z.number().int().min(1).max(5).default(4),
    position: z.enum(["upper", "center", "lower"]).default("lower"),
    uppercase: z.boolean().default(false),
    highlightColor: z.string().default("#FFE14D"),
    emphasisWords: z.array(z.string()).default([]),
    design: CaptionDesign.optional(),
  }),
  music: z
    .object({
      trackId: z.string(),
      volume: z.number().min(0).max(1).default(0.12),
      alignDropToSrc: z.number().nullable().default(null), // put the track's drop on this source moment
      snapCutsToBeats: z.boolean().default(false),
    })
    .nullable(),
  transitions: z.array(z.object({ afterSegment: z.number().int(), type: TransitionType })).default([]),
  zooms: z.array(z.object({ srcTime: z.number(), kind: z.enum(["punch", "slow-push"]), scale: z.number().min(1).max(1.8).default(1.25) })).default([]),
  sfx: z.array(z.object({ srcTime: z.number(), sfxId: z.string(), volume: z.number().min(0).max(1).default(0.8) })).default([]),
  overlays: z.array(z.object({ srcTime: z.number(), text: z.string(), durationSec: z.number().default(1.2) })).default([]),
});
export type AgentPlan = z.infer<typeof AgentPlan>;

// ---------- EditPlan: render-ready (output-time based) ----------
export const EditPlan = z.object({
  version: z.literal(1),
  id: z.string(),
  title: z.string(),
  style: StylePreset,
  rationale: z.string(),
  aspect: Aspect,
  fps: z.number().default(30),
  width: z.number(),
  height: z.number(),
  durationSec: z.number(),
  source: z.object({ videoId: z.string(), src: z.string(), width: z.number(), height: z.number() }),
  hookText: z.string().nullable(),
  clips: z.array(
    z.object({ id: z.string(), start: z.number(), end: z.number(), srcStart: z.number(), srcEnd: z.number(), speed: z.number() }),
  ),
  captions: z.object({
    enabled: z.boolean(),
    preset: CaptionPreset,
    position: z.enum(["upper", "center", "lower"]),
    uppercase: z.boolean(),
    highlightColor: z.string(),
    design: CaptionDesign.optional(),
    chunks: z.array(
      z.object({
        start: z.number(),
        end: z.number(),
        words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number(), emphasis: z.boolean() })),
      }),
    ),
  }),
  music: z
    .object({ trackId: z.string(), url: z.string(), title: z.string(), bpm: z.number(), trackStart: z.number(), volume: z.number(), beats: z.array(z.number()) })
    .nullable(), // beats are output-time beat markers (for the timeline)
  transitions: z.array(z.object({ at: z.number(), type: TransitionType, durationSec: z.number() })),
  zooms: z.array(z.object({ start: z.number(), end: z.number(), scale: z.number(), kind: z.enum(["punch", "slow-push"]) })),
  sfx: z.array(z.object({ at: z.number(), sfxId: z.string(), url: z.string(), name: z.string(), volume: z.number() })),
  overlays: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })),
  stats: z
    .object({ planMs: z.number(), outputTokens: z.number(), tps: z.number(), model: z.string() })
    .nullable()
    .default(null),
});
export type EditPlan = z.infer<typeof EditPlan>;

export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};
