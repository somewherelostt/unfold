"use client";
import type { CaptionPreset } from "@unfold/core";
import { FONTS, ensureFonts } from "@unfold/video";
import { useEffect } from "react";

/** Same preset → face mapping the video composition uses, so UI swatches match the render. */
const FACE: Record<CaptionPreset, keyof typeof FONTS> = {
  "bold-pop": "anton",
  "clean-pop": "montserrat",
  meme: "bangers",
  story: "editorial",
  karaoke: "montserrat",
};
export const captionFamily = (preset: CaptionPreset) => FONTS[FACE[preset]];

/** Load the in-video caption faces for UI previews (idempotent). */
export function useCaptionFonts() {
  useEffect(() => ensureFonts(), []);
}
