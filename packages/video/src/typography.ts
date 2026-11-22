import type { EditPlan } from "@unfold/core";

/** Shared by composition styling and server review without loading the font runtime. */
export const FONTS = {
  anton: "Anton, 'Arial Narrow', Impact, sans-serif",
  montserrat: "Montserrat, 'Arial Black', sans-serif",
  bangers: "Bangers, Impact, 'Comic Sans MS', sans-serif",
  poppins: "Poppins, 'Helvetica Neue', Arial, sans-serif",
  editorial: "Lora, Georgia, serif",
} as const;

/** Base type size: ~100px on a 1080-wide vertical frame. */
export const unit = (plan: Pick<EditPlan, "width" | "height">) => Math.min(plan.width, plan.height) / 1080;
