"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * 9:16 video card: footage edge to edge, 14px radius, bottom gradient with title + mono meta.
 * `play="hover"` autoplays muted on hover; `play="view"` plays while on screen; `play="never"` shows the poster.
 * `overlay` renders on top of the footage (e.g. burned-in captions).
 */
export function VideoCard({
  src,
  poster,
  title,
  meta,
  overlay,
  play = "hover",
  className = "",
  rounded = "rounded-[14px]",
}: {
  src: string;
  poster?: string;
  title?: ReactNode;
  meta?: ReactNode;
  overlay?: ReactNode;
  play?: "hover" | "view" | "never";
  className?: string;
  rounded?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v || play !== "view") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { rootMargin: "120px" });
    io.observe(v);
    return () => io.disconnect();
  }, [play]);

  const hover =
    play === "hover"
      ? {
          onMouseEnter: () => ref.current?.play().catch(() => {}),
          onMouseLeave: () => ref.current?.pause(),
        }
      : {};

  return (
    <div
      {...hover}
      className={`group relative aspect-[9/16] overflow-hidden bg-black shadow-[inset_0_0_0_1px_var(--hairline)] ${rounded} ${className}`}
    >
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload={play === "view" ? "metadata" : "none"}
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
      {overlay}
      {(title || meta) && (
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pb-2.5 pt-12">
          {title && <span className="truncate text-[13px] font-medium text-white">{title}</span>}
          {meta && <span className="tabular shrink-0 font-mono text-[11px] text-white/60">{meta}</span>}
        </div>
      )}
      <div className={`pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] ${rounded}`} />
    </div>
  );
}
