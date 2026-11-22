import React, { useMemo } from "react";
import { AbsoluteFill, spring, useCurrentFrame } from "remotion";
import type { EditPlan } from "@unfold/core";
import { activeCaptionWord, resolveCaptionDesign } from "../captionDesign";
import { captionChunkIndexAt, orderCaptionChunks } from "../captionTiming";
import { clamp, easeOutCubic, safeArea, unit } from "../util";

/** A separate outline layer keeps the letter interiors sharp. */
export const StrokedText: React.FC<{
  children: string;
  color: string;
  stroke: number;
  strokeColor?: string;
  shadow?: string;
  style?: React.CSSProperties;
}> = ({ children, color, stroke, strokeColor = "#000", shadow, style }) => (
  <span style={{ position: "relative", display: "inline-block", ...style }}>
    {stroke > 0 && <span aria-hidden style={{ position: "absolute", inset: 0, color: strokeColor, WebkitTextStroke: `${stroke * 2}px ${strokeColor}`, filter: shadow, strokeLinejoin: "round" }}>{children}</span>}
    <span style={{ position: "relative", color, filter: stroke > 0 ? undefined : shadow }}>{children}</span>
  </span>
);

export const Captions: React.FC<{ plan: EditPlan; avoidTop?: boolean }> = ({ plan }) => {
  const frame = useCurrentFrame();
  const t = frame / plan.fps;
  const chunks = useMemo(() => orderCaptionChunks(plan.captions.chunks), [plan.captions.chunks]);
  const c = plan.captions;
  if (!c.enabled || !chunks.length) return null;
  const ci = captionChunkIndexAt(chunks, t);
  if (ci < 0) return null;
  const chunk = chunks[ci];
  const look = resolveCaptionDesign(c);
  const u = unit(plan);
  const since = frame - Math.round(chunk.start * plan.fps);
  const active = activeCaptionWord(chunk.words, t);
  const longestWord = Math.max(...chunk.words.map((w) => w.text.length), 1);
  const size = Math.min(look.size * u, (plan.width * 0.74) / (longestWord * 0.61));
  const safe = safeArea(plan);
  const progress = easeOutCubic(since / 6);
  let transform: string | undefined;
  let opacity = 1;
  if (look.animation === "fade") opacity = clamp(since / 4, 0, 1);
  if (look.animation === "rise") { opacity = progress; transform = `translateY(${(1 - progress) * 10 * u}px)`; }
  if (look.animation === "pop") {
    const p = spring({ frame: since, fps: plan.fps, config: { damping: 20, stiffness: 250, mass: 0.7 } });
    transform = `scale(${0.94 + 0.06 * p})`;
  }

  const pos = c.position;
  const box: React.CSSProperties = { position: "absolute", left: plan.width * 0.09, right: plan.width * 0.13, display: "flex", justifyContent: "center", textAlign: "center" };
  if (pos === "upper") box.top = plan.height * (safe.top + 0.04);
  else if (pos === "lower") box.bottom = plan.height * (safe.bottom + 0.035);
  else { box.top = plan.height * 0.5; box.transform = "translateY(-50%)"; }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={box}>
        <div style={{ fontFamily: look.family, fontWeight: look.fontWeight, fontSize: size, lineHeight: 1.32, letterSpacing: look.typeface === "condensed" ? "0.012em" : "-0.012em", transform, opacity, display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", gap: `${size * 0.06}px ${size * 0.22}px` }}>
          {chunk.words.map((w, i) => {
            const lit = look.highlightMode !== "none" && (i === active || (w.emphasis && look.highlightMode === "word"));
            const background = look.highlightMode === "background" && i === active;
            const text = c.uppercase ? w.text.toUpperCase() : w.text;
            return (
              <span key={i} style={{ position: "relative", display: "inline-block", whiteSpace: "nowrap" }}>
                {background && <span style={{ position: "absolute", inset: "0 -0.11em", borderRadius: "0.12em", background: c.highlightColor }} />}
                <StrokedText color={background ? "#111111" : lit ? c.highlightColor : look.textColor} stroke={background ? 0 : look.stroke * u} shadow={background ? undefined : `drop-shadow(0 ${2 * u}px ${5 * u}px rgba(0,0,0,.65))`}>
                  {text}
                </StrokedText>
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
