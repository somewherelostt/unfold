import type { CaptionDesign, CaptionPreset, EditPlan } from "@unfold/core";
import { FONTS } from "./typography";

const BASE: CaptionDesign = { typeface: "sans", fontScale: 1, weight: "medium", textColor: "#FFFFFF", highlightMode: "word", animation: "fade", outline: false };

export const CAPTION_DESIGNS: Record<CaptionPreset, CaptionDesign> = {
  "clean-pop": { ...BASE },
  story: { ...BASE, typeface: "serif", weight: "regular", highlightMode: "none", animation: "fade" },
  karaoke: { ...BASE, highlightMode: "background", animation: "fade" },
  "bold-pop": { ...BASE, typeface: "condensed", weight: "bold", animation: "pop", outline: true },
  meme: { ...BASE, typeface: "condensed", weight: "bold", animation: "pop", outline: true },
};

const SIZES: Record<CaptionPreset, number> = { "clean-pop": 64, story: 68, karaoke: 68, "bold-pop": 96, meme: 108 };

export function resolveCaptionDesign(captions: Pick<EditPlan["captions"], "preset" | "design">) {
  const design = { ...CAPTION_DESIGNS[captions.preset], ...captions.design };
  const family = design.typeface === "serif" ? FONTS.editorial : design.typeface === "rounded" ? FONTS.poppins : design.typeface === "condensed" ? (captions.preset === "meme" ? FONTS.bangers : FONTS.anton) : FONTS.montserrat;
  const weight = design.typeface === "condensed" ? 400 : design.typeface === "serif" ? (design.weight === "bold" ? 600 : design.weight === "medium" ? 500 : 400) : design.weight === "bold" ? 800 : design.weight === "medium" ? 600 : 400;
  return { ...design, family, fontWeight: weight, size: SIZES[captions.preset] * design.fontScale, stroke: design.outline ? (captions.preset === "meme" ? 4 : 2.5) : 0 };
}

const textKey = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Avoid showing the same opening sentence as a title and a subtitle at once. */
export function hookRepeatsOpening(plan: Pick<EditPlan, "hookText" | "captions">) {
  if (!plan.hookText || !plan.captions.enabled) return false;
  const hook = textKey(plan.hookText);
  if (!hook) return false;
  const opening = textKey(plan.captions.chunks.flatMap((c) => c.words).filter((w) => w.start < 2.4).sort((a, b) => a.start - b.start).map((w) => w.text).join(" "));
  return (` ${opening} `).includes(` ${hook} `);
}

export function activeCaptionWord(words: { start: number }[], t: number) {
  let active = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].start <= t + 0.001) active = i;
    else break;
  }
  return active;
}
