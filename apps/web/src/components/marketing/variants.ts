// Demo variants for the landing page. Frames come from the hero raw clip (public/landing/hero-*.jpg).
export type DemoVariant = {
  name: string;
  hook: [string, string]; // [plain, emphasis]
  frame: string;
  tint: string; // overlay gradient that gives each edit its own grade
  emphasis: "yellow" | "flare";
  meta: string;
};

export const DEMO_VARIANTS: DemoVariant[] = [
  { name: "Gaming montage", hook: ["wait for", "it"], frame: "/landing/hero-0.jpg", tint: "linear-gradient(160deg,#FF5A1Fcc,#1a0b2ecc)", emphasis: "yellow", meta: "128 bpm · 0:18" },
  { name: "Storytime", hook: ["nobody told", "me"], frame: "/landing/hero-1.jpg", tint: "linear-gradient(160deg,#2a1d5ccc,#0b0b0ccc)", emphasis: "yellow", meta: "90 bpm · 0:34" },
  { name: "Chaos", hook: ["bro", "what"], frame: "/landing/hero-2.jpg", tint: "linear-gradient(160deg,#FF4FA3cc,#7B5CFFcc)", emphasis: "yellow", meta: "140 bpm · 0:12" },
  { name: "Podcast clip", hook: ["this changed", "everything"], frame: "/landing/hero-3.jpg", tint: "linear-gradient(160deg,#101014dd,#2F80EDaa)", emphasis: "flare", meta: "no music · 0:41" },
  { name: "Clean pop", hook: ["3 seconds to", "win"], frame: "/landing/hero-4.jpg", tint: "linear-gradient(160deg,#7B5CFFcc,#0b0b0ccc)", emphasis: "yellow", meta: "118 bpm · 0:22" },
  { name: "Cinematic", hook: ["the last", "round"], frame: "/landing/hero-5.jpg", tint: "linear-gradient(180deg,#0b0b0cdd,#3A3A40aa)", emphasis: "flare", meta: "84 bpm · 0:27" },
  { name: "Hype cut", hook: ["watch the", "ending"], frame: "/landing/hero-6.jpg", tint: "linear-gradient(160deg,#FFB020cc,#FF5A1Fcc)", emphasis: "yellow", meta: "150 bpm · 0:15" },
  { name: "Meme edit", hook: ["he really", "did that"], frame: "/landing/hero-7.jpg", tint: "linear-gradient(160deg,#18B26Bcc,#0b0b0ccc)", emphasis: "yellow", meta: "128 bpm · 0:19" },
  { name: "Copied style", hook: ["pov you", "clutch"], frame: "/landing/hero-8.jpg", tint: "linear-gradient(160deg,#FF5A1Fbb,#FF4FA3bb,#7B5CFFbb)", emphasis: "yellow", meta: "from link · 0:21" },
];
