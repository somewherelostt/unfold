import React from "react";
import { AbsoluteFill, random, spring, useCurrentFrame } from "remotion";
import type { EditPlan } from "@unfold/core";
import { FONTS } from "../fonts";
import { StrokedText } from "./Captions";
import { clamp, safeArea, unit } from "../util";

type Look = "slam" | "meme" | "box";

function lookFor(plan: EditPlan): Look {
  if (plan.captions.preset === "meme" || plan.style === "chaos") return "meme";
  if (plan.captions.preset === "story" || plan.style === "storytime" || plan.style === "podcast-clip") return "box";
  return "slam";
}

/** A big punchy text block: slams in, breathes, pops out. Used for the hook and overlays. */
const PopText: React.FC<{
  plan: EditPlan;
  text: string;
  start: number;
  end: number;
  size: number;
  top: number; // px
  seed: string;
}> = ({ plan, text, start, end, size, top, seed }) => {
  const frame = useCurrentFrame();
  const fps = plan.fps;
  const t = frame / fps;
  if (t < start || t >= end) return null;
  const u = unit(plan);
  const look = lookFor(plan);
  const since = frame - Math.round(start * fps);
  const left = Math.round((end - t) * fps);
  const hl = plan.captions.highlightColor;

  const inS = spring({ frame: since, fps, config: look === "box" ? { damping: 15, stiffness: 200 } : { damping: 10, stiffness: 190, mass: 0.8 } });
  const outP = clamp(1 - left / 5, 0, 1);
  const breathe = 1 + 0.025 * Math.sin(since * 0.18);
  let scale = 1;
  let rot = 0;
  let blur = 0;
  let tx = 0;
  let ty = 0;
  if (look === "box") {
    scale = (0.86 + 0.14 * inS) * (1 - 0.1 * outP);
    ty = (1 - inS) * 30 * u;
  } else {
    scale = (2.3 - 1.3 * inS) * breathe * (1 - 0.35 * outP);
    blur = Math.max(0, (1 - inS) * 18 * u);
    rot = look === "meme" ? (random(`${seed}-rot`) > 0.5 ? -4 : 4) * inS : -1.5 * inS;
    // impact shake right after landing
    if (since > 3 && since < 12) {
      const a = (12 - since) / 9;
      tx = (random(`${seed}-x${frame}`) - 0.5) * 18 * u * a;
      ty = (random(`${seed}-y${frame}`) - 0.5) * 18 * u * a;
    }
  }
  const opacity = clamp(since / 3, 0, 1) * (1 - outP);
  const words = plan.captions.uppercase || look !== "box" ? text.toUpperCase() : text;

  let content: React.ReactNode;
  if (look === "box") {
    content = (
      <span
        style={{
          fontFamily: FONTS.poppins,
          fontWeight: 800,
          fontSize: size * 0.72 * u,
          lineHeight: 1.42,
          color: "#0B0B0C",
          background: "#FFFFFF",
          padding: `${0.06 * size * u}px ${0.22 * size * u}px`,
          borderRadius: 16 * u,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
          boxShadow: `0 ${10 * u}px ${30 * u}px rgba(0,0,0,.35)`,
        }}
      >
        {words}
      </span>
    );
  } else {
    const isMeme = look === "meme";
    content = (
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: size * u * 0.22 }}>
        {words.split(/\s+/).map((w, i) => (
          <StrokedText
            key={i}
            color={i % 2 === (isMeme ? 1 : 0) ? hl : "#FFFFFF"}
            stroke={12 * u}
            shadow={`drop-shadow(0 ${9 * u}px 0 rgba(0,0,0,.6))`}
            style={{
              fontFamily: isMeme ? FONTS.bangers : FONTS.anton,
              fontSize: size * u * (isMeme ? 1.05 : 1),
              letterSpacing: isMeme ? "0.03em" : "0.005em",
              lineHeight: 1.02,
            }}
          >
            {w}
          </StrokedText>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: plan.width * 0.08,
        right: plan.width * 0.08,
        textAlign: "center",
        display: "flex",
        justifyContent: "center",
        transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${scale})`,
        transformOrigin: "50% 50%",
        opacity,
        filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
      }}
    >
      {content}
    </div>
  );
};

export const HOOK_SEC = 2.3;

export const Hook: React.FC<{ plan: EditPlan }> = ({ plan }) => {
  if (!plan.hookText) return null;
  const safe = safeArea(plan);
  const top = plan.captions.position === "upper" ? plan.height * 0.36 : plan.height * (safe.top + 0.05);
  const end = Math.min(HOOK_SEC, plan.durationSec);
  const len = plan.hookText.length;
  const size = len > 32 ? 112 : len > 20 ? 136 : 160;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <PopText plan={plan} text={plan.hookText} start={0} end={end} size={size} top={top} seed="hook" />
    </AbsoluteFill>
  );
};

export const Overlays: React.FC<{ plan: EditPlan }> = ({ plan }) => {
  const safe = safeArea(plan);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {plan.overlays.map((o, i) => (
        <PopText
          key={i}
          plan={plan}
          text={o.text}
          start={o.start}
          end={o.end}
          size={o.text.length > 20 ? 80 : 96}
          top={plan.captions.position === "upper" ? plan.height * 0.4 : plan.height * (safe.top + 0.12)}
          seed={`ov${i}`}
        />
      ))}
    </AbsoluteFill>
  );
};
