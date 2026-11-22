"use client";
import type { EditPlan } from "@unfold/core";
import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { previewReadiness, type PreviewReadiness } from "@/lib/client/preview-readiness";
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
  const container = useRef<HTMLDivElement>(null);
  const [readiness, setReadiness] = useState<PreviewReadiness>("loading");
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const inspect = () => {
      const videos = Array.from(root.querySelectorAll("video")).filter((video) => {
        const rect = video.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      setReadiness((previous) => videos.length === 0 && previous === "error" ? previous : previewReadiness(videos));
    };
    const events = ["loadstart", "loadedmetadata", "loadeddata", "seeking", "seeked", "waiting", "canplay", "error", "emptied"];
    for (const event of events) root.addEventListener(event, inspect, true);
    const observer = new MutationObserver(inspect);
    observer.observe(root, { childList: true, subtree: true });
    const frame = requestAnimationFrame(inspect);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      for (const event of events) root.removeEventListener(event, inspect, true);
    };
  }, [plan.id, plan.source.src]);
  return (
    <div ref={container} className="relative size-full">
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
      errorFallback={() => <PreviewFailure />}
      style={{ width: "100%", height: "100%", ...style }}
      className={className}
    />
      {readiness === "loading" && <div role="status" aria-live="polite" className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-black/45 p-4 text-center text-[12px] text-white">Loading preview…</div>}
      {readiness === "error" && <PreviewFailure />}
    </div>
  );
}

function PreviewFailure() {
  return <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black p-4 text-center text-[12px] leading-5 text-white">
    <p>This preview could not load its video. Your saved edit is still available.</p>
    <button type="button" onClick={() => window.location.reload()} className="rounded-full border border-white/30 px-3 py-1.5">Reload preview</button>
  </div>;
}
