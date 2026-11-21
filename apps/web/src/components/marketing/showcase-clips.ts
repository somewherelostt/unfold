// Landing showcase clips ("Made with Unfold"): 7s muted vertical loops in /public/landing.
// Sources are CC BY videos, so each keeps a `credit` that the footer lists. Swap for Unfold's own renders later.
export type ShowcaseClip = {
  slug: string;
  src: string;
  poster: string;
  tag: string; // Gaming, Podcast, Vlog …
  title: string;
  /** Caption overlay drawn on top. Omit when the clip already has captions burned in (real Unfold renders). */
  caption?: [string, string];
  style?: "pop" | "box" | "chaos" | "clean";
  wide?: boolean; // 16:9 tile spanning two columns
  credit: { name: string; url: string };
};

const clip = (slug: string) => ({ slug, src: `/landing/${slug}.mp4`, poster: `/landing/${slug}.jpg` });

export const SHOWCASE: ShowcaseClip[] = [
  {
    ...clip("gaming"),
    tag: "Gaming",
    title: "Solo match, montage cut",
    caption: ["41 kills", "one game"],
    style: "pop",
    credit: { name: "JMR", url: "https://www.youtube.com/watch?v=QvGIdSHDCTI" },
  },
  {
    ...clip("podcast"),
    tag: "Podcast",
    title: "Hour-long episode, one hook",
    caption: ["he really", "said that"],
    style: "box",
    credit: { name: "Neal Brennan", url: "https://www.youtube.com/watch?v=cxyowd71_Qw" },
  },
  {
    ...clip("vlog"),
    tag: "Vlog",
    title: "Travel vlog, storytime",
    caption: ["nobody told me", "about this"],
    style: "clean",
    credit: { name: "Dee Shanell TV", url: "https://www.youtube.com/watch?v=JiCvwiiyjOY" },
  },
  {
    ...clip("parkour"),
    tag: "Chaos",
    title: "Parkour run, brainrot edit",
    caption: ["do not", "fall"],
    style: "chaos",
    credit: { name: "Orbital", url: "https://www.youtube.com/watch?v=u7kdVe8q5zs" },
  },
  {
    ...clip("food"),
    tag: "Street food",
    title: "Market walk, beat-synced",
    caption: ["₹40 for", "all this"],
    style: "box",
    credit: { name: "Street Food Love", url: "https://www.youtube.com/watch?v=0ot8qQw1oTg" },
  },
  {
    ...clip("skate"),
    tag: "Copied style",
    title: "Archive skate clip, style from a link",
    caption: ["pov 1990s", "san francisco"],
    style: "pop",
    credit: { name: "San Francisco Public Library", url: "https://www.youtube.com/watch?v=Zc7NglqtgNg" },
  },
];

/** Small looping thumbnails above the hero headline. */
export const HERO_THUMBS = [SHOWCASE[0], SHOWCASE[2], SHOWCASE[1], SHOWCASE[3]];

/** Raw clip the hero unfolds. */
export const HERO_RAW = { src: "/landing/gaming.mp4", poster: "/landing/gaming.jpg" };
