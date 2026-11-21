"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FINAL_SECONDS, UnfoldGrid, useUnfoldCycle } from "./UnfoldReveal";
import { IconBolt, IconSend } from "./icons";

const DECISIONS: [string, string, string][] = [
  ["hook", "opens on 0:41, “wait for it”", "#FFE14D"],
  ["music", "drift track · 128 bpm · 8 cuts on beat", "#2F80ED"],
  ["sfx", "boom ×3 · scratch ×1", "#FF4FA3"],
  ["cut", "whip pan ×4 · punch zoom ×6", "#FFB020"],
];

/** Coded replica of the product: agent chat, the unfolding variants grid, and the timeline. */
export function ProductMockup() {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const { open, planning, elapsed } = useUnfoldCycle(seen);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section aria-label="Product preview" className="relative z-10 -mt-6 px-5 sm:px-8 md:-mt-10">
      <div
        ref={ref}
        data-in={seen}
        className="mk-rise mk-hair mx-auto flex max-w-6xl flex-col overflow-hidden rounded-2xl bg-[var(--mk-raised)] md:aspect-[16/10]"
        style={{ boxShadow: "inset 0 0 0 .5px var(--mk-line), var(--mk-shadow-deep)" }}
      >
        {/* Top bar */}
        <div className="mk-hair-bottom flex h-10 shrink-0 items-center justify-between gap-3 px-3">
          <div className="flex min-w-0 items-center gap-2 text-[12px]">
            <img src="/logo-mark.svg" alt="" className="h-4 w-[18px]" />
            <span className="mk-t3 hidden sm:inline">Projects</span>
            <span className="mk-t4 hidden sm:inline">/</span>
            <span className="mk-t1 truncate">solo_match_raw.mp4</span>
          </div>
          <div className="hidden items-center gap-5 text-[12px] md:flex">
            <span className="mk-t1 relative">
              Variants
              <span className="absolute -bottom-[11px] left-0 h-0.5 w-full rounded-full bg-flare" />
            </span>
            <span className="mk-t3">Editor</span>
            <span className="mk-t3">Export</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="tabular hidden items-center gap-1.5 rounded-full bg-violet/10 px-2 py-0.5 font-mono text-[11px] text-violet sm:inline-flex">
              <IconBolt size={11} />
              {planning ? `${elapsed.toFixed(1)}s` : `${FINAL_SECONDS.toFixed(1)}s · 700 tok/s`}
            </span>
            <span className="rounded-md bg-flare px-2.5 py-1 text-[12px] font-medium text-flare-ink">Export</span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Agent chat */}
          <aside className="mk-hair hidden w-[264px] shrink-0 flex-col md:flex" style={{ boxShadow: "inset -.5px 0 0 var(--mk-line)" }}>
            <div className="flex-1 space-y-4 overflow-hidden p-3 text-[12px] leading-5">
              <div className="mk-hair ml-6 rounded-lg rounded-br-sm bg-[var(--bg)] p-2 mk-t1">
                Make it a montage. Meme sounds on every kill, keep it under 20s.
              </div>
              <div className="space-y-2">
                {planning ? (
                  <p className="mk-shimmer font-medium">Planning 9 edits…</p>
                ) : (
                  <p className="mk-t1">9 edits ready. Each one changes the hook, track, cut order and caption style.</p>
                )}
                <ul className={`space-y-1.5 transition-opacity duration-300 ${planning ? "opacity-40" : "opacity-100"}`}>
                  {DECISIONS.map(([k, v, c]) => (
                    <li key={k} className="flex items-start gap-2 font-mono text-[10.5px] leading-4">
                      <span className="mt-[5px] size-1.5 shrink-0 rounded-full" style={{ background: c }} />
                      <span className="mk-t3 w-9 shrink-0">{k}</span>
                      <span className="mk-t2">{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="p-3">
              <div className="mk-hair flex items-center justify-between rounded-lg bg-[var(--bg)] py-1.5 pl-2.5 pr-1.5 text-[12px]">
                <span className="mk-t4">Faster pacing, fewer sounds…</span>
                <span className="grid size-6 place-items-center rounded-full bg-[var(--surface-2)] mk-t3">
                  <IconSend size={12} />
                </span>
              </div>
            </div>
          </aside>

          {/* Variants grid */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[var(--bg)] px-4 py-6 md:py-5">
            <UnfoldGrid open={open} className="w-full max-w-[250px] md:h-full md:w-auto md:max-w-none" style={{ aspectRatio: "27 / 48" } as CSSProperties} />
          </div>
        </div>

        {/* Timeline */}
        <div className="mk-hair-top shrink-0 px-3 pb-3 pt-2.5">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] mk-t3">
            <span>Variant 1 · Gaming montage</span>
            <span className="tabular">0:00 / 0:18</span>
          </div>
          <div className="relative space-y-1">
            <Track label="video">
              <div className="flex h-full gap-px overflow-hidden rounded-[3px]">
                {Array.from({ length: 14 }).map((_, i) => (
                  <img key={i} src={`/landing/hero-${i % 9}.jpg`} alt="" className="h-full flex-1 object-cover opacity-90" />
                ))}
              </div>
            </Track>
            <Track label="captions">
              {[["WAIT", 2, 7], ["FOR IT", 9, 9], ["41", 31, 5], ["KILLS", 37, 8], ["ONE GAME", 58, 12], ["BRO", 80, 6]].map(([w, x, wd]) => (
                <span
                  key={String(w)}
                  className="absolute inset-y-0 grid place-items-center truncate rounded-[3px] bg-track-captions px-1 font-mono text-[8.5px] font-semibold text-white"
                  style={{ left: `${x}%`, width: `${wd}%` }}
                >
                  {w}
                </span>
              ))}
            </Track>
            <Track label="music">
              <div className="absolute inset-0 rounded-[3px] bg-track-music/25" />
              {Array.from({ length: 16 }).map((_, i) => (
                <span key={i} className="mk-beat absolute inset-y-0.5 w-px bg-track-music" style={{ left: `${3 + i * 6.1}%`, "--i": i % 8 } as CSSProperties} />
              ))}
            </Track>
            <Track label="sfx">
              {[["💥", 12], ["📀", 34], ["💥", 52], ["🔔", 71], ["💥", 88]].map(([e, x], i) => (
                <span key={i} className="absolute inset-y-0 grid w-6 place-items-center rounded-[3px] bg-track-sfx/80 text-[9px]" style={{ left: `${x}%` }}>
                  {e}
                </span>
              ))}
            </Track>
            <Track label="fx" className="hidden sm:flex">
              {[20, 41, 63, 84].map((x) => (
                <span key={x} className="absolute top-1/2 size-2.5 -translate-y-1/2 rotate-45 rounded-[2px] bg-track-transition" style={{ left: `${x}%` }} />
              ))}
            </Track>
            <div className="pointer-events-none absolute -bottom-1 -top-1 left-[52px] right-0 sm:left-[60px]">
              <span className="mk-playhead absolute inset-y-0 left-0 w-px bg-flare" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Track({ label, children, className = "flex" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`${className} h-4 items-center gap-2 sm:h-5`}>
      <span className="w-11 shrink-0 font-mono text-[9.5px] mk-t4 sm:w-[52px]">{label}</span>
      <div className="relative h-full flex-1">{children}</div>
    </div>
  );
}
