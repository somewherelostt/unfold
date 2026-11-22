// Example clips for the landing page: 7s muted vertical loops in /public/landing.
// Sources are CC BY videos, so each keeps a `credit` that the footer lists. Swap for Unfold's own renders later.
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
  vlog: { ...clip("vlog"), tag: "Talking head", words: ["nobody", "told", "me", "about", "this"], hot: [4], style: "clean", bpm: 92, credit: { name: "Dee Shanell TV", url: "https://www.youtube.com/watch?v=JiCvwiiyjOY" } },
  podcast: { ...clip("podcast"), tag: "Podcast", words: ["he", "really", "said", "that"], hot: [2, 3], style: "box", bpm: 0, credit: { name: "Neal Brennan", url: "https://www.youtube.com/watch?v=cxyowd71_Qw" } },
  food: { ...clip("food"), tag: "Vlog", words: ["₹40", "for", "all", "this"], hot: [0], style: "pop", bpm: 110, credit: { name: "Street Food Love", url: "https://www.youtube.com/watch?v=0ot8qQw1oTg" } },
  parkour: { ...clip("parkour"), tag: "Chaos", words: ["do", "not", "fall"], hot: [2], style: "chaos", bpm: 140, credit: { name: "Orbital", url: "https://www.youtube.com/watch?v=u7kdVe8q5zs" } },
  skate: { ...clip("skate"), tag: "Archive", words: ["pov", "1990s", "san", "francisco"], hot: [1], style: "pop", bpm: 96, credit: { name: "San Francisco Public Library", url: "https://www.youtube.com/watch?v=Zc7NglqtgNg" } },
};

export const ALL_CLIPS = Object.values(CLIPS);
