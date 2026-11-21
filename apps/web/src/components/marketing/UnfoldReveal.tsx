"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DEMO_VARIANTS } from "./variants";
import { HERO_RAW } from "./showcase-clips";
import { PhoneTile } from "./PhoneTile";

const PLAN_MS = 1900; // the "raw clip, agent planning" beat
const HOLD_MS = 6400; // how long the grid stays open
const FOLD_MS = 900;
export const FINAL_SECONDS = 7.6; // ~5,300 tokens at ~700 tok/s (measured 580–760 at kickoff)

export type UnfoldPhase = "planning" | "unfolded" | "folding";

/** Drives the loop: planning (raw clip + timer) → unfolded grid → fold back → repeat. */
export function useUnfoldCycle(active = true) {
  const [phase, setPhase] = useState<UnfoldPhase>("planning");
  const [elapsed, setElapsed] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduce) {
      timers.push(
        setTimeout(() => {
          setPhase("unfolded");
          setElapsed(FINAL_SECONDS);
        }, 0),
      );
      return () => timers.forEach(clearTimeout);
    }

    const cycle = () => {
      if (cancelled) return;
      setPhase("planning");
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / PLAN_MS);
        setElapsed(+(p * FINAL_SECONDS).toFixed(1));
        if (p < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      timers.push(setTimeout(() => setPhase("unfolded"), PLAN_MS));
      timers.push(setTimeout(() => setPhase("folding"), PLAN_MS + HOLD_MS));
      timers.push(setTimeout(cycle, PLAN_MS + HOLD_MS + FOLD_MS));
    };
    timers.push(setTimeout(cycle, 500));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [active]);

  return { phase, elapsed, open: phase === "unfolded", planning: phase === "planning" && elapsed < FINAL_SECONDS };
}

/** One raw clip stacked on the centre cell, fanning out into a 3×3 grid of 9:16 edits. */
export function UnfoldGrid({ open, className = "", style }: { open: boolean; className?: string; style?: CSSProperties }) {
  return (
    <div className={`relative ${className}`} style={style}>
      <div className="mk-grid" data-state={open ? "unfolded" : "folded"}>
        {DEMO_VARIANTS.map((v, i) => (
          <div
            key={i}
            className={`mk-tile mk-frame mk-dark-frame ${open ? "shadow-[0_10px_24px_-12px_rgb(0_0_0/.5)]" : ""}`}
            style={{ "--i": i, "--r": Math.floor(i / 3), "--c": i % 3 } as CSSProperties}
          >
            <PhoneTile v={v} />
          </div>
        ))}
      </div>

      {/* Raw clip sits on top of the stack while the agent plans. */}
      <div className="mk-raw-layer mk-grid pointer-events-none absolute inset-0">
        <div
          className="mk-raw mk-frame mk-dark-frame relative overflow-hidden rounded-xl bg-black shadow-[0_20px_50px_-15px_rgb(0_0_0/.6)]"
          style={{ gridColumn: 2, gridRow: 2, aspectRatio: "9 / 16" }}
        >
          <video
            src={HERO_RAW.src}
            poster={HERO_RAW.poster}
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden
          />
          <div className="mk-scan absolute inset-0" />
          <span className="absolute left-1.5 top-1.5 z-[3] rounded-full bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-white">
            raw
          </span>
        </div>
      </div>
    </div>
  );
}
