import React, { useMemo } from "react";
import { AbsoluteFill, random, spring, useCurrentFrame } from "remotion";
import type { CaptionPreset, EditPlan } from "@unfold/core";
import { captionChunkIndexAt, orderCaptionChunks } from "../captionTiming";
import { captionFont } from "../fonts";
import { clamp, easeOutCubic, safeArea, unit } from "../util";

type Chunk = EditPlan["captions"]["chunks"][number];
type W = Chunk["words"][number];

const cleanWord = (s: string, upper: boolean) => {
  const t = s.replace(/[,.;:…]+$/u, "").replace(/^["“]|["”]$/gu, "");
  return upper ? t.toUpperCase() : t;
};

/** Text with a real outside stroke: a stroked copy underneath, clean fill on top. */
export const StrokedText: React.FC<{
  children: string;
  color: string;
  stroke: number;
  strokeColor?: string;
  shadow?: string;
  style?: React.CSSProperties;
}> = ({ children, color, stroke, strokeColor = "#000", shadow, style }) => (
  <span style={{ position: "relative", display: "inline-block", ...style }}>
    {stroke > 0 ? (
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          color: strokeColor,
          WebkitTextStroke: `${stroke * 2}px ${strokeColor}`,
          filter: shadow,
          strokeLinejoin: "round",
        }}
      >
        {children}
      </span>
    ) : null}
    <span style={{ position: "relative", color, filter: stroke > 0 ? undefined : shadow }}>{children}</span>
  </span>
);

type PresetStyle = {
  size: number; // px at 1080 base
  lineHeight: number;
  letterSpacing: string;
  stroke: number;
  shadow: string;
  maxWidth: number; // fraction of frame width
};

const PRESET: Record<CaptionPreset, PresetStyle> = {
  "bold-pop": { size: 124, lineHeight: 1.02, letterSpacing: "0.01em", stroke: 11, shadow: "drop-shadow(0 7px 0 rgba(0,0,0,.55))", maxWidth: 0.82 },
  "clean-pop": { size: 92, lineHeight: 1.08, letterSpacing: "-0.01em", stroke: 9, shadow: "drop-shadow(0 6px 10px rgba(0,0,0,.45))", maxWidth: 0.82 },
  meme: { size: 138, lineHeight: 1.0, letterSpacing: "0.03em", stroke: 11, shadow: "drop-shadow(0 8px 0 rgba(0,0,0,.6))", maxWidth: 0.84 },
  story: { size: 80, lineHeight: 1.16, letterSpacing: "-0.005em", stroke: 0, shadow: "drop-shadow(0 3px 8px rgba(0,0,0,.75))", maxWidth: 0.8 },
  karaoke: { size: 86, lineHeight: 1.25, letterSpacing: "-0.01em", stroke: 8, shadow: "drop-shadow(0 5px 8px rgba(0,0,0,.45))", maxWidth: 0.84 },
};

function Word({
  w,
  idx,
  chunkIdx,
  t,
  frame,
  fps,
  preset,
  plan,
  chunkStartFrame,
}: {
  w: W;
  idx: number;
  chunkIdx: number;
  t: number;
  frame: number;
  fps: number;
  preset: CaptionPreset;
  plan: EditPlan;
  chunkStartFrame: number;
}) {
  const u = unit(plan);
  const P = PRESET[preset];
  const hl = plan.captions.highlightColor;
  const text = cleanWord(w.text, plan.captions.uppercase);
  const spoken = t >= w.start - 0.02;
  const active = spoken && t < w.end + 0.08;
  const wordFrame = Math.round(w.start * fps);
  const sinceWord = frame - wordFrame;
  const emph = w.emphasis;
  const size = P.size * u * (emph ? 1.18 : 1);

  switch (preset) {
    case "bold-pop": {
      // Words land one by one as they're spoken; the landing word punches in.
      const pop = spoken ? spring({ frame: sinceWord, fps, config: { damping: 11, stiffness: 260, mass: 0.6 } }) : 0;
      const scale = spoken ? 0.55 + 0.45 * pop + (active ? 0.06 : 0) : 0.55;
      return (
        <>
          <StrokedText
            color={emph ? hl : active ? "#FFFFFF" : "#F4F4F4"}
            stroke={P.stroke * u}
            shadow={P.shadow}
            style={{
              fontSize: size,
              opacity: spoken ? 1 : 0,
              transform: `scale(${scale}) rotate(${emph ? -3 : 0}deg)`,
              transformOrigin: "50% 60%",
            }}
          >
            {text}
          </StrokedText>
        </>
      );
    }
    case "clean-pop": {
      const pop = spoken ? spring({ frame: sinceWord, fps, config: { damping: 14, stiffness: 300 } }) : 0;
      const scale = active ? 1 + 0.1 * pop : 1;
      return (
        <>
          <StrokedText
            color={active || emph ? hl : "#FFFFFF"}
            stroke={P.stroke * u}
            shadow={P.shadow}
            style={{ fontSize: size, transform: `scale(${scale})`, transformOrigin: "50% 60%" }}
          >
            {text}
          </StrokedText>
        </>
      );
    }
    case "meme": {
      const wob = Math.sin((frame + idx * 7 + chunkIdx * 13) * 0.32) * 2.4;
      const shakeAmt = emph && active ? 7 * u : active ? 2 * u : 0;
      const sx = (random(`mx${chunkIdx}-${idx}-${frame}`) - 0.5) * 2 * shakeAmt;
      const sy = (random(`my${chunkIdx}-${idx}-${frame}`) - 0.5) * 2 * shakeAmt;
      const pop = spoken ? spring({ frame: sinceWord, fps, config: { damping: 8, stiffness: 220, mass: 0.7 } }) : 0;
      const scale = spoken ? 0.85 + 0.15 * pop + (emph && active ? 0.12 : 0) : 0.85;
      return (
        <>
          <StrokedText
            color={emph ? hl : "#FFFFFF"}
            stroke={P.stroke * u}
            shadow={P.shadow}
            style={{
              fontSize: size * (emph ? 1.08 : 1),
              transform: `translate(${sx}px, ${sy}px) rotate(${wob}deg) scale(${scale})`,
              transformOrigin: "50% 60%",
              opacity: frame - chunkStartFrame >= 0 ? 1 : 0,
            }}
          >
            {text}
          </StrokedText>
        </>
      );
    }
    case "story": {
      const a = spoken ? 0.55 + 0.45 * clamp(sinceWord / 4, 0, 1) : 0.55;
      return (
        <>
          <StrokedText color={emph ? hl : "#FFFFFF"} stroke={0} shadow={P.shadow} style={{ fontSize: size * (emph ? 0.95 : 1), opacity: a }}>
            {text}
          </StrokedText>
        </>
      );
    }
    case "karaoke": {
      const pop = active ? spring({ frame: sinceWord, fps, config: { damping: 13, stiffness: 320 } }) : 0;
      const padX = 0.2 * P.size * u;
      return (
        <>
          <span
            style={{
              position: "relative",
              display: "inline-block",
              padding: `0 ${padX}px`,
              transform: active ? `scale(${0.7 + 0.3 * pop}) rotate(-2deg)` : undefined,
            }}
          >
            {active ? (
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "8%",
                  bottom: "4%",
                  background: hl,
                  borderRadius: 18 * u,
                  boxShadow: `0 ${8 * u}px 0 rgba(0,0,0,.35)`,
                }}
              />
            ) : null}
            <StrokedText
              color={active ? "#0B0B0C" : emph ? hl : "#FFFFFF"}
              stroke={active ? 0 : P.stroke * u}
              shadow={active ? undefined : P.shadow}
              style={{ fontSize: size, opacity: spoken || active ? 1 : 0.85 }}
            >
              {text}
            </StrokedText>
          </span>
        </>
      );
    }
  }
}

export const Captions: React.FC<{ plan: EditPlan; avoidTop?: boolean }> = ({ plan }) => {
  const frame = useCurrentFrame();
  const fps = plan.fps;
  const t = frame / fps;
  const { captions } = plan;
  const chunks = useMemo(() => orderCaptionChunks(captions.chunks), [captions.chunks]);
  if (!captions.enabled || chunks.length === 0) return null;

  const ci = captionChunkIndexAt(chunks, t);
  if (ci < 0) return null;
  const chunk = chunks[ci];
  const preset = captions.preset;
  const P = PRESET[preset];
  const font = captionFont[preset];
  const u = unit(plan);
  const safe = safeArea(plan);
  const H = plan.height;

  const startFrame = Math.round(chunk.start * fps);
  const since = frame - startFrame;

  // Chunk-level entrance.
  let transform = "";
  let opacity = 1;
  if (preset === "clean-pop" || preset === "karaoke") {
    const s = spring({ frame: since, fps, config: { damping: 13, stiffness: 340, mass: 0.6 } });
    transform = `scale(${0.82 + 0.18 * s})`;
  } else if (preset === "meme") {
    const s = spring({ frame: since, fps, config: { damping: 7, stiffness: 240, mass: 0.7 } });
    const rot = (random(`chunk-rot-${ci}`) - 0.5) * 9;
    transform = `scale(${0.4 + 0.6 * s}) rotate(${rot * s}deg)`;
  } else if (preset === "story") {
    const p = easeOutCubic(since / 7);
    transform = `translateY(${(1 - p) * 26 * u}px)`;
    opacity = p;
  } else if (preset === "bold-pop") {
    const s = spring({ frame: since, fps, config: { damping: 12, stiffness: 280 } });
    transform = `translateY(${(1 - s) * 14 * u}px)`;
  }

  const pos = preset === "story" && captions.position === "center" ? "lower" : captions.position;
  const box: React.CSSProperties = {
    position: "absolute",
    left: (1 - P.maxWidth) * 0.5 * plan.width,
    right: (1 - P.maxWidth) * 0.5 * plan.width,
    display: "flex",
    justifyContent: "center",
    textAlign: "center",
  };
  if (pos === "upper") box.top = H * (safe.top + 0.07);
  else if (pos === "lower") box.bottom = H * (safe.bottom + (preset === "story" ? 0.06 : 0.05));
  else {
    box.top = 0;
    box.bottom = 0;
    box.alignItems = "center";
    box.paddingTop = H * 0.06; // optical center sits a touch low; keeps faces clear
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {preset === "story" ? (
        <AbsoluteFill
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,.55) 0%, rgba(0,0,0,.25) 28%, rgba(0,0,0,0) 45%)",
          }}
        />
      ) : null}
      <div style={box}>
        <div
          style={{
            fontFamily: font.family,
            fontWeight: font.weight,
            lineHeight: P.lineHeight,
            letterSpacing: P.letterSpacing,
            transform,
            opacity,
            transformOrigin: "50% 50%",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "baseline",
            rowGap: P.size * u * 0.05,
            columnGap: P.size * u * (preset === "karaoke" ? 0.04 : 0.26),
          }}
        >
          {chunk.words.map((w, i) => (
            <Word
              key={i}
              w={w}
              idx={i}
              chunkIdx={ci}
              t={t}
              frame={frame}
              fps={fps}
              preset={preset}
              plan={plan}
              chunkStartFrame={startFrame}
            />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
