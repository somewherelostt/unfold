import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadBangers } from "@remotion/google-fonts/Bangers";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadLora } from "@remotion/google-fonts/Lora";
import type { CaptionPreset } from "@unfold/core";

/** Font stacks used in-video. Loaded by the font loader from a web font CDN (needs network at preview/render time). */
export const FONTS = {
  anton: "Anton, 'Arial Narrow', Impact, sans-serif",
  montserrat: "Montserrat, 'Arial Black', sans-serif",
  bangers: "Bangers, Impact, 'Comic Sans MS', sans-serif",
  poppins: "Poppins, 'Helvetica Neue', Arial, sans-serif",
  editorial: "Lora, Georgia, serif",
} as const;

let loaded = false;
/** Idempotent; a no-op on the server (Next SSR). Called at module load of the composition. */
export function ensureFonts() {
  if (loaded || typeof window === "undefined" || typeof document === "undefined") return;
  loaded = true;
  const opts = { subsets: ["latin" as const], ignoreTooManyRequestsWarning: true };
  loadAnton("normal", { ...opts, weights: ["400"] });
  loadBangers("normal", { ...opts, weights: ["400"] });
  loadMontserrat("normal", { ...opts, weights: ["400", "500", "600", "800", "900"] });
  loadPoppins("normal", { ...opts, weights: ["400", "500", "600", "700", "800"] });
  loadLora("normal", { ...opts, weights: ["400", "500", "600"] });
}

export const captionFont: Record<CaptionPreset, { family: string; weight: number }> = {
  "bold-pop": { family: FONTS.anton, weight: 400 },
  "clean-pop": { family: FONTS.montserrat, weight: 600 },
  meme: { family: FONTS.bangers, weight: 400 },
  story: { family: FONTS.editorial, weight: 500 },
  karaoke: { family: FONTS.montserrat, weight: 600 },
};
