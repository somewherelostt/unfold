import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, random, useCurrentFrame } from "remotion";
import type { EditPlan } from "@unfold/core";
import type { Fx } from "../fx";
import { easeOutCubic, resolveSrc } from "../util";

type Clip = EditPlan["clips"][number];

/**
 * Cover-crop the source into the output frame. When the source is taller than the frame
 * (cropping top/bottom) bias slightly upward so faces stay in frame.
 */
function objectPosition(plan: EditPlan) {
  const srcAR = plan.source.width / Math.max(1, plan.source.height);
  const outAR = plan.width / plan.height;
  return srcAR < outAR ? "50% 38%" : "50% 50%";
}

const ClipVideo: React.FC<{
  plan: EditPlan;
  clip: Clip;
  ownFrames: number;
  slideIn: { at: number; d: number } | null;
  slideOut: { at: number; d: number } | null;
  assetBase?: string;
}> = ({ plan, clip, ownFrames, slideIn, slideOut, assetBase }) => {
  const frame = useCurrentFrame(); // relative to the clip's Sequence
  const fps = plan.fps;
  const t = clip.start + frame / fps;
  let ty = 0;
  if (slideIn && t < slideIn.at + slideIn.d) ty = (1 - easeOutCubic((t - slideIn.at) / slideIn.d)) * plan.height;
  if (slideOut && t >= slideOut.at) ty = -easeOutCubic((t - slideOut.at) / slideOut.d) * plan.height;
  return (
    <AbsoluteFill style={{ transform: ty ? `translateY(${ty}px)` : undefined }}>
      <OffthreadVideo
        src={resolveSrc(plan.source.src, assetBase)}
        trimBefore={Math.round(clip.srcStart * fps)}
        playbackRate={clip.speed}
        // The tail of an outgoing clip under a slide is visual only.
        volume={(f) => (f >= ownFrames ? 0 : 1)}
        pauseWhenBuffering
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: objectPosition(plan) }}
      />
    </AbsoluteFill>
  );
};

export const VideoLayer: React.FC<{ plan: EditPlan; fx: Fx; filterId: string; assetBase?: string }> = ({
  plan,
  fx,
  filterId,
  assetBase,
}) => {
  const frame = useCurrentFrame();
  const fps = plan.fps;
  const slides = plan.transitions.filter((x) => x.type === "slide").map((x) => ({ at: x.at, d: Math.max(0.15, x.durationSec) }));
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5 / fps;

  const filters: string[] = [];
  if (fx.blurX > 0.5 || fx.blurY > 0.5) filters.push(`url(#${filterId}-dir)`);
  if (fx.rgb > 0.5 || fx.glitch > 0.02) filters.push(`url(#${filterId}-glitch)`);
  if (fx.blur > 0.3) filters.push(`blur(${fx.blur.toFixed(2)}px)`);
  if (Math.abs(fx.brightness - 1) > 0.01) filters.push(`brightness(${fx.brightness.toFixed(3)})`);

  const k = fx.rgb;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={`${filterId}-dir`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={`${fx.blurX.toFixed(1)} ${fx.blurY.toFixed(1)}`} edgeMode="duplicate" />
          </filter>
          <filter id={`${filterId}-glitch`} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
            {/* Blocky horizontal slice displacement */}
            <feTurbulence type="fractalNoise" baseFrequency="0.0001 0.045" numOctaves={1} seed={Math.floor(random(`seed-${frame}`) * 1000)} result="n" />
            <feComponentTransfer in="n" result="steps">
              <feFuncR type="discrete" tableValues="0 0.5 0.5 1 0.5 0.5 0 0.5" />
            </feComponentTransfer>
            <feColorMatrix in="steps" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 1" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={fx.glitch * plan.width * 0.08} xChannelSelector="R" yChannelSelector="G" result="d" />
            {/* RGB split */}
            <feColorMatrix in="d" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feOffset in="r" dx={k} dy={0} result="r2" />
            <feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feOffset in="b" dx={-k} dy={k * 0.25} result="b2" />
            <feBlend in="r2" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b2" mode="screen" />
          </filter>
        </defs>
      </svg>
      <AbsoluteFill
        style={{
          transform: `translate(${fx.tx.toFixed(2)}px, ${fx.ty.toFixed(2)}px) rotate(${fx.rot.toFixed(3)}deg) scale(${fx.scale.toFixed(4)})`,
          transformOrigin: "50% 45%",
          filter: filters.length ? filters.join(" ") : undefined,
        }}
      >
        {plan.clips.map((clip) => {
          const from = Math.round(clip.start * fps);
          const to = Math.round(clip.end * fps);
          const ownFrames = Math.max(1, to - from);
          const slideOut = slides.find((s) => near(s.at, clip.end)) ?? null;
          const slideIn = slides.find((s) => near(s.at, clip.start)) ?? null;
          const extra = slideOut ? Math.ceil(slideOut.d * fps) : 0;
          return (
            <Sequence key={clip.id} from={from} durationInFrames={ownFrames + extra} layout="none" name={`clip ${clip.id}`}>
              <ClipVideo plan={plan} clip={clip} ownFrames={ownFrames} slideIn={slideIn} slideOut={slideOut} assetBase={assetBase} />
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
