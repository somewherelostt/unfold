import type { AgentPlan, MediaAnalysis } from "./schema";
import type { Library } from "./compile";

/**
 * Sample data so every part of the app can be built before the real pipeline lands.
 * Files live in apps/web/public/demo (generated placeholders; replaced by real assets later).
 */
const script =
  "okay so this is the craziest thing that happened to me in this game today I was driving down the highway and then out of nowhere a plane just lands right in front of me and I am like what is going on bro this game is insane";

export const sampleAnalysis: MediaAnalysis = {
  videoId: "sample",
  src: "/demo/sample.mp4",
  durationSec: 20,
  width: 1080,
  height: 1920,
  fps: 30,
  hasSpeech: true,
  words: script.split(" ").map((text, i) => ({ text, start: 0.4 + i * 0.42, end: 0.4 + i * 0.42 + 0.36 })),
  scenes: [
    { start: 0, end: 6.2 },
    { start: 6.2, end: 12.8 },
    { start: 12.8, end: 20 },
  ],
  frames: [0, 4, 8, 12, 16].map((t) => ({ t, url: `/demo/frame-${t}.jpg` })),
  loudness: [],
};

const beatsAt = (bpm: number, dur: number, offset = 0) =>
  Array.from({ length: Math.floor(((dur - offset) * bpm) / 60) }, (_, i) => Math.round((offset + (i * 60) / bpm) * 1000) / 1000);

export const sampleLibrary: Library = {
  music: [
    { id: "sample-hype-128", title: "Sample Hype", artist: "placeholder", url: "/demo/music-128.mp3", durationSec: 60, bpm: 128, beats: beatsAt(128, 60), downbeats: beatsAt(32, 60), dropAt: 15, moods: ["hype", "epic"], genres: ["trap"], energy: 0.9, source: "pixabay", sourceUrl: "", },
    { id: "sample-chill-90", title: "Sample Chill", artist: "placeholder", url: "/demo/music-90.mp3", durationSec: 60, bpm: 90, beats: beatsAt(90, 60), downbeats: beatsAt(22.5, 60), dropAt: 8, moods: ["chill", "story"], genres: ["lofi"], energy: 0.4, source: "pixabay", sourceUrl: "", },
  ],
  sfx: [
    { id: "boom", name: "Boom", url: "/demo/sfx-boom.mp3", durationSec: 1, tags: ["boom", "impact", "reveal"], source: "placeholder", license: "CC0" },
    { id: "whoosh", name: "Whoosh", url: "/demo/sfx-whoosh.mp3", durationSec: 0.5, tags: ["whoosh", "transition"], source: "placeholder", license: "CC0" },
    { id: "record-scratch", name: "Record scratch", url: "/demo/sfx-scratch.mp3", durationSec: 0.6, tags: ["scratch", "stop", "fail"], source: "placeholder", license: "CC0" },
    { id: "ding", name: "Ding", url: "/demo/sfx-ding.mp3", durationSec: 0.5, tags: ["ding", "point", "success"], source: "placeholder", license: "CC0" },
  ],
};

export const sampleAgentPlans: AgentPlan[] = [
  {
    title: "Chaos cut",
    style: "chaos",
    rationale: "Cold-open on the plane landing, fast cuts on every beat, meme hits on the reaction.",
    aspect: "9:16",
    hookText: "A PLANE. ON THE HIGHWAY.",
    segments: [
      { srcStart: 12.8, srcEnd: 15.5, speed: 1 },
      { srcStart: 0.3, srcEnd: 4.2, speed: 1.15 },
      { srcStart: 6.4, srcEnd: 12.6, speed: 1.1 },
      { srcStart: 15.5, srcEnd: 19.8, speed: 1 },
    ],
    captions: { enabled: true, preset: "meme", wordsPerChunk: 2, position: "center", uppercase: true, highlightColor: "#FFE14D", emphasisWords: ["plane", "insane", "craziest"] },
    music: { trackId: "sample-hype-128", volume: 0.35, alignDropToSrc: 12.8, snapCutsToBeats: true },
    transitions: [
      { afterSegment: 0, type: "flash" },
      { afterSegment: 1, type: "whip" },
      { afterSegment: 2, type: "zoom-punch" },
    ],
    zooms: [{ srcTime: 13.2, kind: "punch", scale: 1.4 }, { srcTime: 17, kind: "punch", scale: 1.3 }],
    sfx: [{ srcTime: 12.9, sfxId: "boom", volume: 0.9 }, { srcTime: 16.8, sfxId: "record-scratch", volume: 0.8 }],
    overlays: [],
  },
  {
    title: "Storytime",
    style: "storytime",
    rationale: "Keeps the story in order with clean captions and a slow push on the reveal.",
    aspect: "9:16",
    hookText: "wait for it…",
    segments: [{ srcStart: 0.3, srcEnd: 19.8, speed: 1 }],
    captions: { enabled: true, preset: "story", wordsPerChunk: 3, position: "lower", uppercase: false, highlightColor: "#FF5A1F", emphasisWords: ["plane", "insane"] },
    music: { trackId: "sample-chill-90", volume: 0.25, alignDropToSrc: 12.8, snapCutsToBeats: false },
    transitions: [],
    zooms: [{ srcTime: 12.8, kind: "slow-push", scale: 1.2 }],
    sfx: [{ srcTime: 12.9, sfxId: "ding", volume: 0.6 }],
    overlays: [],
  },
];
