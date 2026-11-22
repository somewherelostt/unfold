"use client";

import { useEffect, type ComponentProps, type RefObject } from "react";
import { VideoCard } from "@/components/ui/VideoCard";
import { useMotionScope } from "./hooks";

function usePlayback(ref: RefObject<HTMLElement | null>, live: boolean, src: string) {
  useEffect(() => {
    const host = ref.current;
    const video = host instanceof HTMLVideoElement ? host : host?.querySelector("video");
    if (!video) return;
    if (live) void video.play().catch(() => {});
    else video.pause();
    return () => video.pause();
  }, [ref, live, src]);
}

/** Local examples play only while visible and preserve their playback position. */
export function PreviewVideo({ active = true, ...props }: Omit<ComponentProps<"video">, "autoPlay" | "ref"> & { src: string; active?: boolean }) {
  const { ref, live } = useMotionScope<HTMLVideoElement>(active);
  usePlayback(ref, live, props.src);
  return <video {...props} ref={ref} muted loop playsInline preload="metadata" aria-hidden />;
}

export function PreviewCard({ active = true, ...props }: Omit<ComponentProps<typeof VideoCard>, "play"> & { active?: boolean }) {
  const { ref, live } = useMotionScope<HTMLDivElement>(active);
  usePlayback(ref, live, props.src);
  return <div ref={ref} className="mk-motion min-w-0" data-live={live}><VideoCard {...props} play="never" /></div>;
}
