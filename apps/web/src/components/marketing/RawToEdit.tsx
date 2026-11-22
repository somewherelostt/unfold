"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Caption } from "./Caption";
import { useInView, useMotionScope, useReducedMotion, useTicker } from "./hooks";
import { PreviewVideo } from "./Preview";
import { CLIPS, type Clip } from "./showcase-clips";

const TABS: Clip[] = [CLIPS.gaming, CLIPS.creator, CLIPS.podcast, CLIPS.coast];

/** Native scrolling selects the same example at the same position in either direction. */
function useShowcaseSequence() {
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const geometry = useRef({ pinned: false, travel: 0, top: 76 });
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    const rail = track.current;
    const scene = stage.current;
    if (!rail || !scene) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (reduce) return;
      const r = rail.getBoundingClientRect();
      const { pinned, travel, top } = geometry.current;
      const progress = pinned
        ? (top - r.top) / travel
        : (window.innerHeight * 0.6 - r.top) / (r.height + window.innerHeight * 0.2);
      setActive(Math.min(TABS.length - 1, Math.max(0, Math.floor(progress * TABS.length))));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const measure = () => {
      const top = window.innerWidth >= 640 ? 88 : 76;
      const pinned = !reduce && scene.offsetHeight <= window.innerHeight - top - 24;
      const travel = pinned
        ? Math.round(Math.min(400, Math.max(240, window.innerHeight * 0.42))) * (TABS.length - 1)
        : 0;
      geometry.current = { pinned, travel, top };
      rail.dataset.pinned = String(pinned);
      rail.style.setProperty("--showcase-height", pinned ? `${scene.offsetHeight + travel}px` : "auto");
      onScroll();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scene);
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, [reduce]);

  const select = (i: number) => {
    const { pinned, travel, top } = geometry.current;
    if (reduce || !pinned || !track.current) {
      setActive(i);
      return;
    }
    const start = window.scrollY + track.current.getBoundingClientRect().top - top;
    window.scrollTo({ top: start + ((i + 0.5) / TABS.length) * travel, behavior: "smooth" });
  };

  return { track, stage, active, select };
}

export function RawToEdit() {
  const { track, stage, active, select } = useShowcaseSequence();
  return (
    <section id="showcase" aria-label="Raw clip to finished edit" className="mk-section !pt-8">
      <div className="mk-container">
        <div>
          <p className="mk-label">From raw to ready</p>
          <h2 className="mk-title mt-3 max-w-[620px]">
            Watch a raw clip become an <em>edit.</em>
          </h2>
          <p className="mt-4 max-w-[520px] text-[15px] leading-6 text-text-2">Explore the look of an edit. These previews illustrate captions and effects on example footage.</p>
        </div>
        <div ref={track} className="mk-showcase-scroll mt-8 lg:mt-10">
          <div ref={stage} className="mk-showcase-sticky">
            <div className="mb-4 flex items-center justify-between gap-4 sm:mb-6">
              <div role="tablist" aria-label="Example clips" className="flex w-max max-w-full gap-px overflow-x-auto rounded-[12px] bg-surface-2 p-1 mk-hair sm:gap-0.5">
                {TABS.map((t, i) => (
                  <button
                    key={t.slug}
                    role="tab"
                    id={`showcase-tab-${i}`}
                    aria-controls={`showcase-panel-${i}`}
                    aria-selected={active === i}
                    tabIndex={active === i ? 0 : -1}
                    onClick={() => select(i)}
                    onKeyDown={(e) => {
                      let next = i;
                      if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
                      else if (e.key === "ArrowLeft") next = (i + TABS.length - 1) % TABS.length;
                      else if (e.key === "Home") next = 0;
                      else if (e.key === "End") next = TABS.length - 1;
                      else return;
                      e.preventDefault();
                      select(next);
                      document.getElementById(`showcase-tab-${next}`)?.focus({ preventScroll: true });
                    }}
                    className={`h-8 shrink-0 cursor-pointer rounded-[9px] px-2 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-300 ease-[var(--ease)] sm:px-3 ${
                      active === i ? "bg-surface-1 text-text-1 shadow-[var(--shadow-raised)]" : "text-text-3 hover:text-text-1"
                    }`}
                  >
                    {t.tag}
                  </button>
                ))}
              </div>
              <span aria-hidden className="hidden font-mono text-[11px] tabular-nums text-text-3 sm:block">0{active + 1} / 04</span>
            </div>
            <div className="mk-showcase-card mk-card p-3 sm:p-6 lg:p-10">
              <div className="grid">
                {TABS.map((clip, i) => (
                  <div key={clip.slug} className="mk-showcase-panel mk-dark" data-phase={active === i ? "active" : i < active ? "before" : "after"}
                    id={`showcase-panel-${i}`} role="tabpanel" tabIndex={active === i ? 0 : -1} aria-labelledby={`showcase-tab-${i}`} aria-hidden={active !== i} inert={active !== i}>
                    <Frame clip={clip} active={active === i} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Frame({ clip, active }: { clip: Clip; active: boolean }) {
  const { ref: box, live: visible } = useMotionScope<HTMLDivElement>(active);
  const seen = useInView(box, { amount: 0.3 });
  const beat = clip.bpm ? Math.round(60000 / clip.bpm) : 520;
  const word = useTicker(clip.words.length, beat, seen && visible);

  return (
    <div
      ref={box}
      data-live={seen && visible}
      className="mk-motion overflow-hidden rounded-[18px] bg-surface-1 shadow-[0_24px_60px_-20px_rgb(0_0_0/.45)] lg:aspect-[16/9] lg:w-full"
    >
      <div className="flex h-full flex-col">
        {/* Top bar */}
        <div className="flex h-10 shrink-0 items-center justify-between gap-3 px-3 shadow-[inset_0_-1px_0_var(--hairline)]">
          <div className="flex min-w-0 items-center gap-2 text-[12px]">
            <img src="/logo-mark.svg" alt="" className="h-4 w-[18px]" />
            <span className="hidden text-text-3 sm:inline">Projects /</span>
            <span className="truncate text-text-1">{clip.slug}_raw.mp4</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[11px] text-text-3 sm:inline">Illustrative preview</span>
            <span className="rounded-[8px] bg-primary-btn px-2.5 py-1 text-[12px] font-medium text-primary-btn-ink">Export</span>
          </div>
        </div>

        {/* Raw | Edit */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 bg-bg p-3 sm:gap-6 sm:p-6 lg:grid-cols-[1fr_auto_1.2fr] lg:items-center lg:gap-10 lg:px-16">
          <Panel label="Raw" muted>
            <PreviewVideo active={active} src={clip.src} poster={clip.poster} className="h-full w-full object-cover saturate-[.35] brightness-90" />
          </Panel>
          <div className="hidden flex-col items-center gap-2 lg:flex" aria-hidden>
            <span className="h-px w-16 bg-gradient-to-r from-transparent via-[var(--hairline-strong)] to-transparent" />
            <span className="tabular rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-text-2 mk-hair">
              <span className="text-accent">Unfold</span> your clip
            </span>
            <span className="h-px w-16 bg-gradient-to-r from-transparent via-[var(--hairline-strong)] to-transparent" />
          </div>
          <Panel label="Edit">
            <div className={`absolute inset-0 ${clip.bpm ? "mk-thump" : ""}`} style={{ animationDuration: `${beat}ms` }}>
              <div className={`absolute inset-0 ${clip.bpm > 0 ? "mk-punch" : ""}`} style={{ animationDuration: `${beat * 4}ms` }}>
                <PreviewVideo active={active} src={clip.src} poster={clip.poster} className="h-full w-full object-cover saturate-[1.2] contrast-[1.06]" />
              </div>
            </div>
            {clip.bpm > 0 && <div className="mk-flash pointer-events-none absolute inset-0 bg-white" style={{ animationDuration: `${beat * 4}ms` }} />}
            <div className="pointer-events-none absolute inset-x-2 top-[58%]">
              <div key={word} className="mk-pop">
                <Caption words={[clip.words[word]]} hot={clip.hot.includes(word) ? [0] : []} style={clip.style} size={30} />
              </div>
            </div>
            {clip.bpm > 0 && (
              <span className="tabular absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white">♪ {clip.bpm} bpm</span>
            )}
          </Panel>
        </div>

        <Timeline clip={clip} beat={beat} />
      </div>
    </div>
  );
}

function Panel({ label, muted, children }: { label: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col items-center gap-2 lg:h-full">
      <div className={`relative aspect-[9/16] w-full overflow-hidden rounded-[14px] bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] lg:h-full lg:w-auto ${muted ? "opacity-90" : "shadow-[var(--shadow-float)]"}`}>
        {children}
      </div>
      <span className="mk-label">{label}</span>
    </div>
  );
}

function Timeline({ clip, beat }: { clip: Clip; beat: number }) {
  const caps = clip.words.map((w, i) => ({ w, x: 3 + i * (90 / clip.words.length), wd: 70 / clip.words.length }));
  return (
    <div className="shrink-0 px-3 pb-3 pt-2 shadow-[inset_0_1px_0_var(--hairline)] sm:px-4">
      <div className="tabular mb-1.5 flex justify-between pl-[52px] font-mono text-[10px] text-text-4 sm:pl-[64px]">
        {["0:00", "0:02", "0:04", "0:06", "0:08"].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="relative space-y-1">
        <Track label="video">
          <div className="flex h-full gap-px overflow-hidden rounded-[6px]">
            {Array.from({ length: 12 }).map((_, i) => (
              <img key={i} src={clip.poster} alt="" className="h-full flex-1 object-cover opacity-80" style={{ objectPosition: `${(i * 37) % 100}% 50%` }} />
            ))}
          </div>
        </Track>
        <Track label="captions">
          {caps.map((c) => (
            <span
              key={c.w}
              className="absolute inset-y-0 grid place-items-center truncate rounded-[6px] bg-track-captions px-1 font-mono text-[9px] font-medium uppercase text-track-captions-ink"
              style={{ left: `${c.x}%`, width: `${c.wd}%` }}
            >
              {c.w}
            </span>
          ))}
        </Track>
        <Track label="music">
          <div className="absolute inset-0 overflow-hidden rounded-[6px] bg-track-music">
            <div className="flex h-full items-center gap-[2px] px-1">
              {Array.from({ length: 64 }).map((_, i) => (
                <span key={i} className="flex-1 rounded-full bg-track-music-wave/80" style={{ height: `${(25 + Math.abs(Math.sin(i * 1.3) * Math.cos(i * 0.37)) * 70).toFixed(1)}%` }} />
              ))}
            </div>
          </div>
          {Array.from({ length: 16 }).map((_, i) => (
            <span
              key={i}
              className="mk-tick absolute -inset-y-0.5 w-px"
              style={{ left: `${2 + i * 6.25}%`, background: i % 4 === 0 ? "var(--downbeat)" : "var(--beat)", animationDuration: `${beat}ms`, "--d": `${(i % 4) * 0}ms` } as CSSProperties}
            />
          ))}
        </Track>
        <Track label="sfx" className="hidden sm:flex">
          {[["💥", 14], ["📀", 38], ["💥", 61], ["🔔", 83]].map(([e, x], i) => (
            <span key={i} className="absolute inset-y-0 grid w-7 place-items-center rounded-full bg-track-sfx text-[10px]" style={{ left: `${x}%` }}>
              {e}
            </span>
          ))}
        </Track>
        <Track label="fx" className="hidden sm:flex">
          {[26, 50, 74].map((x) => (
            <span key={x} className="absolute top-1/2 size-2.5 -translate-y-1/2 rotate-45 rounded-[2px] bg-track-transition-ink" style={{ left: `${x}%` }} />
          ))}
        </Track>
        <div className="pointer-events-none absolute -bottom-1 -top-1 left-[52px] right-0 sm:left-[64px]">
          <span className="mk-sweep absolute inset-y-0 w-px bg-accent" style={{ "--sweep": "10s", animationDelay: "1100ms" } as CSSProperties}>
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-accent" />
          </span>
        </div>
      </div>
    </div>
  );
}

function Track({ label, children, className = "flex" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`${className} h-5 items-center gap-2 sm:h-6`}>
      <span className="w-11 shrink-0 font-mono text-[10px] text-text-3 sm:w-[56px]">{label}</span>
      <div className="relative h-full flex-1">{children}</div>
    </div>
  );
}
