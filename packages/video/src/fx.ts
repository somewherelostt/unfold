import { random } from "remotion";
import type { EditPlan } from "@unfold/core";
import { clamp, easeInCubic, easeInOutSine, easeOutBack, easeOutCubic } from "./util";

/** Per-frame camera state for the video layer, derived from zooms, transitions and beats. */
export type Fx = {
  scale: number;
  tx: number; // px
  ty: number; // px
  rot: number; // deg
  blurX: number; // px, directional (whip)
  blurY: number; // px, directional (slide)
  blur: number; // px, uniform
  rgb: number; // px, RGB channel split (glitch)
  glitch: number; // 0..1 slice displacement amount
  flash: number; // 0..1 white overlay
  brightness: number;
};

const NONE: Fx = { scale: 1, tx: 0, ty: 0, rot: 0, blurX: 0, blurY: 0, blur: 0, rgb: 0, glitch: 0, flash: 0, brightness: 1 };

function clipEndAfter(plan: EditPlan, t: number) {
  const c = plan.clips.find((c) => t >= c.start && t < c.end);
  return c ? c.end : plan.durationSec;
}

function zoomScale(plan: EditPlan, t: number) {
  let s = 1;
  for (const z of plan.zooms) {
    if (t < z.start) continue;
    let k = 1;
    if (z.kind === "punch") {
      const inDur = 0.09;
      const outDur = 0.22;
      const len = Math.max(z.end - z.start, inDur + outDur);
      const local = t - z.start;
      if (local > len) continue;
      if (local < inDur) k = 1 + (z.scale - 1) * easeOutBack(local / inDur, 2.2);
      else if (local > len - outDur) k = 1 + (z.scale - 1) * (1 - easeInOutSine((local - (len - outDur)) / outDur));
      else k = z.scale;
    } else {
      // slow-push: ease in over its span, then hold to the next cut (the cut hides the reset),
      // or ease back if there's no cut soon.
      const hold = Math.min(clipEndAfter(plan, Math.min(z.end, plan.durationSec - 0.001)), z.end + 1.5);
      if (t <= z.end) k = 1 + (z.scale - 1) * easeInOutSine((t - z.start) / Math.max(0.01, z.end - z.start));
      else if (t < hold) k = z.scale;
      else if (t < hold + 0.5 && hold < clipEndAfter(plan, hold)) k = 1 + (z.scale - 1) * (1 - easeInOutSine((t - hold) / 0.5));
      else continue;
    }
    s = Math.max(s, k);
  }
  return s;
}

export function computeFx(plan: EditPlan, t: number, frame: number): Fx {
  const fx: Fx = { ...NONE };
  const W = plan.width;
  fx.scale = zoomScale(plan, t);

  // Beat pulse on high-energy styles: tiny scale kick on every beat, decays fast.
  if (plan.music && (plan.style === "chaos" || plan.style === "gaming-montage")) {
    let last = -Infinity;
    for (const b of plan.music.beats) {
      if (b <= t) last = b;
      else break;
    }
    const since = t - last;
    if (since >= 0 && since < 0.18) fx.scale *= 1 + 0.03 * Math.pow(1 - since / 0.18, 2);
  }

  plan.transitions.forEach((tr, i) => {
    const d = Math.max(tr.durationSec, 0.12);
    const half = d / 2;
    const u = (t - tr.at) / half; // -1..1 around the cut
    switch (tr.type) {
      case "whip": {
        if (u < -1 || u > 1) return;
        const dir = i % 2 === 0 ? -1 : 1;
        const p = 1 - Math.abs(u);
        const off = u < 0 ? easeInCubic(1 + u) : 1 - easeOutCubic(u);
        fx.tx += dir * (u < 0 ? 1 : -1) * off * W * 0.22;
        fx.blurX = Math.max(fx.blurX, Math.pow(p, 0.8) * W * 0.07);
        fx.scale *= 1 + 0.18 * p;
        fx.brightness *= 1 + 0.15 * p;
        return;
      }
      case "zoom-punch": {
        if (u < -1 || u > 1.6) return;
        const p = u < 0 ? easeInCubic(1 + u) : 1 - easeOutCubic(u / 1.6);
        fx.scale *= 1 + 0.45 * p;
        fx.blur = Math.max(fx.blur, p * W * 0.008);
        fx.brightness *= 1 + 0.2 * p;
        return;
      }
      case "flash": {
        if (u < -1 || u > 2.2) return;
        const p = u < 0 ? Math.pow(1 + u, 2) : Math.pow(1 - u / 2.2, 1.6);
        fx.flash = Math.max(fx.flash, p);
        fx.brightness *= 1 + 0.6 * p;
        if (u >= 0) fx.scale *= 1 + 0.06 * p;
        return;
      }
      case "shake": {
        const local = t - (tr.at - 0.04);
        const len = d + 0.25;
        if (local < 0 || local > len) return;
        const a = Math.pow(1 - local / len, 1.5);
        const step = Math.floor(frame / 1); // re-roll every frame
        fx.tx += (random(`sx${i}-${step}`) - 0.5) * 2 * a * W * 0.035;
        fx.ty += (random(`sy${i}-${step}`) - 0.5) * 2 * a * W * 0.035;
        fx.rot += (random(`sr${i}-${step}`) - 0.5) * 2 * a * 2.5;
        fx.scale *= 1 + 0.08 * a;
        fx.blur = Math.max(fx.blur, a * W * 0.003);
        return;
      }
      case "glitch": {
        if (u < -1.2 || u > 1.4) return;
        const p = 1 - Math.min(1, Math.abs(u) / (u < 0 ? 1.2 : 1.4));
        const jitter = 0.5 + random(`g${i}-${frame}`);
        fx.rgb = Math.max(fx.rgb, p * W * 0.018 * jitter);
        fx.glitch = Math.max(fx.glitch, p);
        fx.tx += (random(`gx${i}-${frame}`) - 0.5) * p * W * 0.03;
        return;
      }
      case "slide": {
        // Positional motion is done per clip (see ClipLayer); add motion blur here.
        if (u < 0 || u > 2) return;
        const p = 1 - Math.abs(u - 0.6) / 1.4;
        fx.blurY = Math.max(fx.blurY, clamp(p, 0, 1) * W * 0.05);
        return;
      }
      default:
        return;
    }
  });
  return fx;
}
