// Muted vertical examples. Source links remain with each clip; individual license details sit with new assets.
import type { CaptionStyle } from "./Caption";

export type Clip = {
  slug: string;
  src: string;
  poster: string;
  tag: string;
  words: string[];
  hot: number[];
  style: CaptionStyle;
  bpm: number;
  credit: { name: string; url: string };
};

const clip = (slug: string) => ({ slug, src: `/landing/${slug}.mp4`, poster: `/landing/${slug}.jpg` });

export const CLIPS: Record<string, Clip> = {
  gaming: { ...clip("gaming"), tag: "Gameplay", words: ["41", "kills", "one", "game"], hot: [0, 3], style: "pop", bpm: 128, credit: { name: "JMR", url: "https://www.youtube.com/watch?v=QvGIdSHDCTI" } },
  creator: { ...clip("creator"), tag: "Creator", words: ["Make", "every", "second", "count."], hot: [2, 3], style: "focus", bpm: 104, credit: { name: "Creator footage", url: "https://www.pexels.com/video/a-man-talking-7261920/" } },
  podcast: { ...clip("podcast-centered"), tag: "Podcast", words: ["he", "really", "said", "that"], hot: [2, 3], style: "box", bpm: 0, credit: { name: "Neal Brennan", url: "https://www.youtube.com/watch?v=cxyowd71_Qw" } },
  coast: { ...clip("coast"), tag: "Travel", words: ["One", "more", "wave."], hot: [2], style: "focus", bpm: 0, credit: { name: "Coastal footage", url: "https://www.pexels.com/video/dynamic-ocean-waves-captured-from-above-29285421/" } },
  parkour: { ...clip("parkour"), tag: "Chaos", words: ["do", "not", "fall"], hot: [2], style: "chaos", bpm: 140, credit: { name: "Orbital", url: "https://www.youtube.com/watch?v=u7kdVe8q5zs" } },
  skate: { ...clip("skate"), tag: "Archive", words: ["pov", "1990s", "san", "francisco"], hot: [1], style: "pop", bpm: 96, credit: { name: "San Francisco Public Library", url: "https://www.youtube.com/watch?v=Zc7NglqtgNg" } },
};

export const ALL_CLIPS = Object.values(CLIPS);
