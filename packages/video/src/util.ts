import { getRemotionEnvironment, staticFile } from "remotion";
import type { EditPlan } from "@unfold/core";
export { unit } from "./typography";

export const DEFAULT_FPS = 30;

export function getCompositionConfig(plan: EditPlan) {
  const fps = plan.fps || DEFAULT_FPS;
  return {
    fps,
    width: plan.width,
    height: plan.height,
    durationInFrames: Math.max(1, Math.round(plan.durationSec * fps)),
  };
}

/**
 * Plan URLs are web paths like "/demo/sample.mp4" or "/media/<id>/source.mp4".
 * - In the in-browser player (the web app) they resolve against the site origin as-is.
 * - In the studio / server render they are served from the renderer public dir via staticFile().
 * - `assetBase` (e.g. "http://localhost:3000") forces absolute URLs, useful when rendering
 *   media that lives outside the public dir.
 */
export function resolveSrc(url: string, assetBase?: string): string {
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  if (assetBase) return assetBase.replace(/\/$/, "") + (url.startsWith("/") ? url : `/${url}`);
  if (getRemotionEnvironment().isPlayer) return url;
  return staticFile(url.replace(/^\//, ""));
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
export const easeInCubic = (x: number) => Math.pow(clamp(x, 0, 1), 3);
export const easeInOutSine = (x: number) => -(Math.cos(Math.PI * clamp(x, 0, 1)) - 1) / 2;
export const easeOutBack = (x: number, s = 1.70158) => {
  const t = clamp(x, 0, 1) - 1;
  return t * t * ((s + 1) * t + s) + 1;
};

/** Safe area for short-form platform UI overlays (fractions of the frame). */
export function safeArea(plan: Pick<EditPlan, "aspect" | "width" | "height">) {
  if (plan.aspect === "9:16") return { top: 0.13, bottom: 0.2, left: 0.07, right: 0.15 };
  if (plan.aspect === "1:1") return { top: 0.08, bottom: 0.1, left: 0.07, right: 0.07 };
  return { top: 0.08, bottom: 0.1, left: 0.08, right: 0.08 };
}
