"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { PromptShell } from "@/components/ui/PromptShell";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Caption } from "./Caption";
import { useMotionScope, useScrolled, useTicker } from "./hooks";
import { PreviewCard, PreviewVideo } from "./Preview";
import { CLIPS, type Clip } from "./showcase-clips";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span role="img" aria-label="Unfold" className={`inline-flex items-center text-text-1 ${className}`}>
      <BrandLogo width={112} height={27} />
    </span>
  );
}

/** Two floating pills: logo left, actions right. They pick up a soft shadow once you scroll. */
export function Nav() {
  const scrolled = useScrolled(8);
  const pill = `pointer-events-auto flex h-11 items-center rounded-[12px] bg-surface-2/90 backdrop-blur-xl transition-shadow duration-300 ${
    scrolled ? "shadow-[var(--shadow-raised)]" : "shadow-[inset_0_0_0_1px_var(--hairline)]"
  }`;
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <nav className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-5">
        <div className={`${pill} gap-6 px-4`}>
          <Link href="/" aria-label="Unfold home">
            <Wordmark />
          </Link>
          <span className="hidden items-center gap-5 text-[13px] text-text-2 lg:flex">
            <a href="#styles" className="hover:text-text-1">Features</a>
            <a href="#ways" className="hover:text-text-1">How it works</a>
            <a href="#speed" className="hover:text-text-1">Workflow</a>
            <a href="#faq" className="hover:text-text-1">FAQ</a>
          </span>
        </div>
        <div className={`${pill} gap-1 px-1.5`}>
          <div className="hidden sm:block">
            <ButtonLink href="/login" variant="ghost" size="sm" className="px-3">
              Sign in
            </ButtonLink>
          </div>
          <ButtonLink href="/app" variant="primary" size="sm">
            Start editing
          </ButtonLink>
        </div>
      </nav>
    </header>
  );
}

const BRIEFS = ["Make my gameplay go viral", "Add captions that pop", "Cut this podcast into a reel", "Make it hype, sounds on every kill"];

type Float = { clip: Clip; className: string; r: number; w: number; d: number; drift: number };
const FLOATS: Float[] = [
  { clip: CLIPS.gaming, className: "left-[3%] top-[30%]", r: -9, w: 132, d: 500, drift: 7 },
  { clip: CLIPS.creator, className: "left-[10%] top-[62%]", r: 6, w: 116, d: 580, drift: 9 },
  { clip: CLIPS.podcast, className: "right-[3%] top-[28%]", r: 8, w: 128, d: 540, drift: 8.5 },
  { clip: CLIPS.food, className: "right-[10%] top-[60%]", r: -7, w: 112, d: 620, drift: 7.5 },
];

function FloatingClip({ f }: { f: Float }) {
  return (
    <div className={`mk-float absolute ${f.className}`} style={{ "--r": `${f.r}deg`, "--d": `${f.d}ms`, width: f.w } as CSSProperties}>
      <div className="mk-float-inner" style={{ "--drift": `${f.drift}s`, "--dd": `${-f.d / 100}s` } as CSSProperties}>
        <PreviewCard
          src={f.clip.src}
          poster={f.clip.poster}
          className="shadow-[var(--shadow-float)]"
          overlay={
            <div className="pointer-events-none absolute inset-x-2 top-[56%]">
              <Caption words={f.clip.words} hot={f.clip.hot} style={f.clip.style} size={Math.round(f.w / 7.5)} />
            </div>
          }
        />
      </div>
    </div>
  );
}

/* ---------- inline media chips (each ~1em, looping) ---------- */

function ClipChip({ clip }: { clip: Clip }) {
  return (
    <span className="mk-chip-media" aria-hidden>
      <PreviewVideo src={clip.src} poster={clip.poster} className="absolute inset-0 h-full w-full object-cover" />
    </span>
  );
}

function CaptionChip() {
  const { ref, live } = useMotionScope<HTMLSpanElement>();
  const w = useTicker(3, 520, live);
  return (
    <span ref={ref} data-live={live} className="mk-chip-media mk-motion" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/landing/hero-3.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
      <span key={w} className="mk-pop mk-cap absolute inset-0 grid place-items-center text-[.3em]" style={{ WebkitTextStroke: "0.06em #000", color: w === 2 ? "#FFE14D" : "#fff" }}>
        {["wait", "for", "it"][w]}
      </span>
    </span>
  );
}

function W({ children, d }: { children: ReactNode; d: number }) {
  return (
    <span className="mk-word" style={{ "--d": `${d}ms` } as CSSProperties}>
      {children}
    </span>
  );
}

export function Hero() {
  const { ref, live } = useMotionScope<HTMLElement>();
  return (
    <section ref={ref} data-live={live} className="mk-motion relative overflow-hidden pb-20 pt-32 sm:pt-40 lg:min-h-[800px] lg:pt-40">
      <div className="mk-glow pointer-events-none absolute inset-0" />

      <div aria-hidden className="pointer-events-none absolute inset-0 mx-auto hidden max-w-[1440px] xl:block">
        {FLOATS.map((f) => (
          <FloatingClip key={f.clip.slug} f={f} />
        ))}
      </div>

      <div className="mk-container relative flex flex-col items-center text-center">
        <p className="mk-label">Your new editing agent</p>
        <h1 className="mk-hero-title mk-hero-title-short mt-6 max-w-[900px]" aria-label="You shoot it. Unfold edits it.">
          <W d={0}><ClipChip clip={CLIPS.gaming} /> You shoot it.</W>
          <W d={90}>Unfold edits it. <CaptionChip /></W>
        </h1>
        <p className="mx-auto mt-6 max-w-[540px] text-[17px] leading-7 text-text-2">
          Turn your raw clip into a finished edit with captions, beat-synced music, transitions and sound effects.
        </p>
        <PromptShell className="mt-10 max-w-[640px]" briefs={BRIEFS} />
      </div>
      <div className="mk-ruler pointer-events-none absolute inset-x-0 bottom-0" aria-hidden />
    </section>
  );
}
