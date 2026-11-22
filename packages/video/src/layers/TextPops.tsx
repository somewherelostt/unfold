import React from "react";
import { AbsoluteFill, spring, useCurrentFrame } from "remotion";
import type { EditPlan } from "@unfold/core";
import { hookRepeatsOpening, resolveCaptionDesign } from "../captionDesign";
import { clamp, easeOutCubic, unit } from "../util";

export const HOOK_SEC = 2.3;

const Title: React.FC<{ plan: EditPlan; text: string; start: number; end: number; hook?: boolean }> = ({ plan, text, start, end, hook }) => {
  const frame = useCurrentFrame();
  const t = frame / plan.fps;
  if (t < start || t >= end) return null;
  const look = resolveCaptionDesign(plan.captions);
  const u = unit(plan);
  const entrance = look.animation === "none" ? 1 : easeOutCubic((t - start) / 0.22);
  const exit = look.animation === "none" ? 1 : clamp((end - t) / 0.18, 0, 1);
  const energetic = look.animation === "pop";
  const pop = energetic ? spring({ frame: frame - Math.round(start * plan.fps), fps: plan.fps, config: { damping: 20, stiffness: 220 } }) : 1;
  const transform = energetic ? `scale(${0.94 + 0.06 * pop})` : look.animation === "rise" ? `translateY(${(1 - entrance) * 8 * u}px)` : undefined;
  const top = plan.captions.position === "upper" ? 0.7 : hook ? 0.115 : 0.22;
  return (
    <div style={{ position: "absolute", top: plan.height * top, left: plan.width * 0.12, right: plan.width * 0.16, textAlign: "center", fontFamily: look.family, fontWeight: look.fontWeight, fontSize: (hook ? (energetic ? 84 : 60) : (energetic ? 64 : 48)) * u * look.fontScale, lineHeight: 1.2, letterSpacing: "-0.02em", color: look.textColor, opacity: entrance * exit, transform, textShadow: `0 ${2 * u}px ${8 * u}px rgba(0,0,0,.6)` }}>
      {plan.captions.uppercase ? text.toUpperCase() : text}
    </div>
  );
};

export const Hook: React.FC<{ plan: EditPlan }> = ({ plan }) => {
  if (!plan.hookText || hookRepeatsOpening(plan)) return null;
  return <AbsoluteFill style={{ pointerEvents: "none" }}><Title plan={plan} text={plan.hookText} start={0} end={Math.min(HOOK_SEC, plan.durationSec)} hook /></AbsoluteFill>;
};

export const Overlays: React.FC<{ plan: EditPlan }> = ({ plan }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {plan.overlays.map((o, i) => <Title key={i} plan={plan} text={o.text} start={o.start} end={o.end} />)}
  </AbsoluteFill>
);
