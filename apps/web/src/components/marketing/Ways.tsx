"use client";

import { useState } from "react";
import { IconArrowRight, IconArrowUp, IconLink } from "@/components/ui/icons";
import { Caption } from "./Caption";
import { useInView, useMotionScope, usePinnedStep, useTicker, useTimedProgress } from "./hooks";
import { PreviewVideo } from "./Preview";
import { CLIPS, type Clip } from "./showcase-clips";

const WAYS = [
  { word: "Describe", body: "Type what you want, the way you'd say it to an editor. Unfold plans the whole edit from one line." },
  { word: "Copy a style", body: "Paste a video link or attach a reference. Bring its pacing, captions and energy to your own clip." },
  { word: "Remix", body: "Chat to change anything. “Bigger captions.” “Less bass.” Keep shaping the edit until it feels like you." },
];

/**
 * Create in 3 ways. Desktop: pinned; scrolling steps through the three ways (and back up). The stacked words
 * are also buttons. Small screens, short windows and reduced motion use the buttons without pinning.
 */
export function Ways() {
  const { ref, step } = usePinnedStep<HTMLDivElement>(WAYS.length);
  const [manual, setManual] = useState(0);
  const pinned = step >= 0;
  const active = pinned ? step : manual;

  const go = (i: number) => {
    setManual(i);
    if (!pinned || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const travel = r.height - window.innerHeight;
    window.scrollTo({ top: window.scrollY + r.top + ((i + 0.5) / WAYS.length) * travel, behavior: "smooth" });
  };

  return (
    <section id="ways" className="scroll-mt-24" aria-label="Create in 3 ways">
      <div ref={ref} className="mk-ways-scroll relative">
        <div className="mk-ways-sticky mk-section">
          <div className="mk-container grid items-center gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-20">
            <div className="mk-card mk-ways-stage relative order-2 aspect-[4/5] overflow-hidden sm:aspect-[5/4] lg:order-1 lg:aspect-square">
              <div className="absolute inset-4 sm:inset-8">
                {WAYS.map((way, i) => (
                  <div key={way.word} id={`way-panel-${i}`} className="mk-way-panel mk-dark"
                    data-phase={active === i ? "active" : i < active ? "before" : "after"}
                    role="region" aria-labelledby={`way-button-${i}`} aria-hidden={active !== i} inert={active !== i}>
                    {i === 0 && <DescribeVisual active={active === i} />}
                    {i === 1 && <StyleVisual active={active === i} />}
                    {i === 2 && <RemixVisual active={active === i} />}
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <p className="mk-label">Create in 3 ways</p>
              <h2 className="sr-only">Describe an edit, copy a style, or remix</h2>
              <div className="mt-6 space-y-1 lg:mt-8">
                {WAYS.map((w, i) => (
                  <div key={w.word}>
                    <button
                      id={`way-button-${i}`}
                      aria-controls={`way-panel-${i}`}
                      onClick={() => go(i)}
                      aria-pressed={active === i}
                      className={`block cursor-pointer text-left text-[44px] font-medium leading-[1.05] tracking-[-0.04em] transition-colors duration-300 ease-[var(--ease)] sm:text-[60px] lg:text-[72px] ${
                        active === i ? "text-text-1" : "text-text-4 hover:text-text-3"
                      }`}
                    >
                      {w.word}
                    </button>
                    <div aria-hidden={active !== i} className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[var(--ease)] ${active === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                      <p className="overflow-hidden">
                        <span className="block max-w-[420px] pb-5 pt-3 text-[17px] leading-7 text-text-2">{w.body}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mk-label mt-5">Illustrative previews</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- visuals (dark, live) ---------- */

function useWayDemo(active: boolean) {
  const { ref, live } = useMotionScope<HTMLDivElement>(active);
  const seen = useInView(ref, { amount: 0.35 });
  return { ref, live: seen && live };
}

function Phone({ clip, active, words = clip.words, hot = clip.hot, style = clip.style, size = 22, className = "", word }: { clip: Clip; active: boolean; words?: string[]; hot?: number[]; style?: Clip["style"]; size?: number; className?: string; word?: number }) {
  return (
    <div className={`relative aspect-[9/16] shrink-0 overflow-hidden rounded-[14px] bg-black shadow-[0_24px_60px_-20px_rgb(0_0_0/.7),inset_0_0_0_1px_rgb(255_255_255/.08)] ${className}`}>
      <PreviewVideo active={active} src={clip.src} poster={clip.poster} className="absolute inset-0 h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-x-2 top-[56%]">
        {word === undefined ? <Caption words={words} hot={hot} style={style} size={size} /> : (
          <div key={word} className="mk-pop"><Caption words={[words[word]]} hot={hot.includes(word) ? [0] : []} style={style} size={size * 1.3} /></div>
        )}
      </div>
    </div>
  );
}

function DescribeVisual({ active }: { active: boolean }) {
  const { ref, live } = useWayDemo(active);
  const brief = "Make my gameplay go viral, sounds on every kill";
  const n = useTimedProgress(brief.length, live);
  const done = n >= brief.length;
  const word = useTicker(CLIPS.gaming.words.length, 469, live && done);
  return (
    <div ref={ref} data-live={live} className="mk-motion flex h-full flex-col items-center justify-center gap-5">
      <div className="w-full max-w-[420px] rounded-[16px] bg-surface-1 p-1.5 shadow-[var(--shadow-raised)]">
        <div className="flex items-end justify-between gap-3 rounded-[11px] bg-surface-2 px-3.5 py-3 text-[14px] text-text-1 mk-hair">
          <span className="min-h-[20px]">{brief.slice(0, n)}{!done && <span className="mk-caret ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-accent" />}</span>
          <span className={`grid size-7 shrink-0 place-items-center rounded-full ${done ? "bg-primary-btn text-primary-btn-ink" : "bg-surface-3 text-text-3"}`}><IconArrowUp size={14} /></span>
        </div>
      </div>
      <div className={`flex w-full max-w-[420px] items-center justify-center gap-4 transition-opacity duration-500 ${done ? "opacity-100" : "opacity-0"}`}>
        <Phone active={active && done} clip={CLIPS.gaming} word={word} className="w-[36%] max-w-[150px]" />
        <div className="space-y-2 font-mono text-[11px] text-text-3 sm:text-[12px]">
          <p><span className="text-text-1">✓</span> hook first</p>
          <p><span className="text-text-1">✓</span> cuts on the beat</p>
          <p><span className="text-text-1">✓</span> sound effects placed</p>
          <p className="pt-1 text-text-2">One complete plan</p>
        </div>
      </div>
    </div>
  );
}

function StyleVisual({ active }: { active: boolean }) {
  const { ref, live } = useWayDemo(active);
  const shown = useTimedProgress(4, live, 140, 300);
  return (
    <div ref={ref} data-live={live} className="mk-motion flex h-full flex-col items-center justify-center gap-5">
      <div className="flex w-full max-w-[420px] items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[13px] text-text-2 mk-hair"><IconLink size={14} className="shrink-0 text-text-3" /><span className="truncate">Your inspiration video</span></div>
      <div className="flex w-full max-w-[400px] items-center justify-center gap-3 sm:gap-5">
        <div className="flex w-[35%] flex-col items-center gap-2"><Phone active={active} clip={CLIPS.parkour} size={16} className="w-full -rotate-3 opacity-80" /><span className="mk-label">reference</span></div>
        <IconArrowRight size={18} className="shrink-0 text-text-3" />
        <div className="flex w-[38%] flex-col items-center gap-2"><Phone active={active} clip={CLIPS.gaming} words={["41", "kills"]} hot={[1]} style="chaos" size={18} className="w-full rotate-3" /><span className="mk-label">your clip</span></div>
      </div>
      <div className="flex min-h-8 flex-wrap justify-center gap-1.5">
        {["fast cuts", "bold captions", "punch zooms", "high energy"].map((t, i) => <span key={t} className={`rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-text-2 transition-opacity duration-300 mk-hair ${i < shown ? "opacity-100" : "opacity-0"}`}>{t}</span>)}
      </div>
    </div>
  );
}

function RemixVisual({ active }: { active: boolean }) {
  const { ref, live } = useWayDemo(active);
  const s = useTimedProgress(2, live, 700);
  return (
    <div ref={ref} data-live={live} className="mk-motion flex h-full items-center justify-center gap-4 sm:gap-6">
      <Phone active={active} clip={CLIPS.vlog} size={s >= 2 ? 24 : 16} className="w-[36%] max-w-[160px]" />
      <div className="min-w-0 flex-1 space-y-2.5 text-[12px] sm:text-[13px]">
        <div className="ml-auto w-max max-w-full rounded-[12px] rounded-br-[4px] bg-surface-2 px-3 py-2 text-text-1 mk-hair">Bigger captions</div>
        {s >= 1 && <p className="text-[12px]">{s < 2 ? <span className="mk-shimmer-agent">Working…</span> : <span className="text-text-3">Updated the captions</span>}</p>}
        {s >= 2 && <div className="mk-pop rounded-[12px] bg-surface-2 p-3 mk-hair"><p className="text-text-1">Bigger captions. More room for the moment.</p><p className="mt-2 font-mono text-[11px] text-text-3">caption size ↑ · lines 2 → 1</p></div>}
      </div>
    </div>
  );
}
