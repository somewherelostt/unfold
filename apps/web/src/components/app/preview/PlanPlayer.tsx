"use client";
import type { EditPlan } from "@unfold/core";
import { Player, type PlayerRef } from "@remotion/player";
import type { CSSProperties, Ref } from "react";
import { Composition } from "./composition";

export type { PlayerRef };

export function PlanPlayer({
  plan,
  ref,
  muted = false,
  controls = false,
  loop = true,
  autoPlay = false,
  playbackRate = 1,
  style,
  className,
}: {
  plan: EditPlan;
  ref?: Ref<PlayerRef>;
  muted?: boolean;
  controls?: boolean;
  loop?: boolean;
  autoPlay?: boolean;
  playbackRate?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const fps = plan.fps || 30;
  return (
    <Player
      ref={ref}
      component={Composition}
      inputProps={{ plan }}
      durationInFrames={Math.max(1, Math.round(plan.durationSec * fps))}
      compositionWidth={plan.width}
      compositionHeight={plan.height}
      fps={fps}
      controls={controls}
      loop={loop}
      autoPlay={autoPlay}
      initiallyMuted={muted}
      playbackRate={playbackRate}
      clickToPlay={false}
      acknowledgeRemotionLicense
      style={{ width: "100%", height: "100%", ...style }}
      className={className}
    />
  );
}
