"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DEMO_VARIANTS } from "./variants";
import { HERO_RAW } from "./showcase-clips";
import { PhoneTile } from "./PhoneTile";
import { IconBolt } from "./icons";

const PLAN_MS = 1700; // how long the "raw clip, planning" beat lasts
const HOLD_MS = 6200; // how long the grid stays open
const FOLD_MS = 900;
const FINAL_SECONDS = 7.6; // ~5,300 tokens at ~700 tok/s (measured 580–760 at kickoff)

type Phase = "planning" | "unfolded" | "folding";

/** Hero visual: one raw clip fans out into a 3×3 grid of 9:16 edits, on a loop. */
export function UnfoldReveal() {
  const [phase, setPhase] = useState<Phase>("planning");
  const [elapsed, setElapsed] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
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
    timers.push(setTimeout(cycle, 350));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  const open = phase === "unfolded";
  const done = phase !== "planning" || elapsed >= FINAL_SECONDS;

  return (
    <div className="relative mx-auto w-full max-w-[300px] sm:max-w-[380px] lg:max-w-[372px] xl:max-w-[400px]">
      <div className="mk-glow pointer-events-none absolute -inset-10 -z-10 opacity-70" />

      <div className="relative">
        <div className="mk-grid" data-state={open ? "unfolded" : "folded"}>
          {DEMO_VARIANTS.map((v, i) => (
            <div
              key={i}
              className={`mk-tile ring-1 ring-black/10 dark:ring-white/10 ${open ? "shadow-[0_12px_30px_-12px_rgb(0_0_0/.45)]" : ""}`}
              style={{ "--i": i, "--r": Math.floor(i / 3), "--c": i % 3 } as CSSProperties}
            >
              <PhoneTile v={v} />
            </div>
          ))}
        </div>

        {/* Raw clip sits on top of the stack while the agent plans. */}
        <div className="mk-raw-layer mk-grid pointer-events-none absolute inset-0">
          <div
            className="mk-raw relative overflow-hidden rounded-2xl bg-black shadow-[0_20px_50px_-15px_rgb(0_0_0/.6)] ring-1 ring-white/15"
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
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-white">
              raw
            </span>
          </div>
        </div>
      </div>

      {/* Speed badge */}
      <div className="mt-5 flex justify-center">
        <div
          className="tabular inline-flex items-center gap-2 rounded-full border border-violet/20 bg-violet/10 px-3 py-1.5 font-mono text-[12px] font-medium text-violet sm:text-[13px]"
          aria-live="polite"
        >
          <IconBolt size={13} className="text-flare" />
          {done ? (
            <span>9 edits · {FINAL_SECONDS.toFixed(1)}s · 700 tok/s</span>
          ) : (
            <span>planning 9 edits · {elapsed.toFixed(1)}s</span>
          )}
        </div>
      </div>
    </div>
  );
}
