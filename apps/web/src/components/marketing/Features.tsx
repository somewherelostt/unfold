"use client";
/* eslint-disable @next/next/no-img-element */

import type { ReactNode } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { IconArrowRight, IconCheck, IconLink } from "@/components/ui/icons";
import { CLIPS } from "./showcase-clips";
import { Caption } from "./Caption";
import { useInView, useMotionScope, useTicker, useTimedProgress } from "./hooks";
import { PreviewCard } from "./Preview";

/** Starts once at 35% visible; `live` is false while off screen so loops pause. */
function useDemo() {
  const { ref, live } = useMotionScope<HTMLDivElement>();
  const started = useInView(ref, { amount: 0.35 });
  return { ref, live: started && live };
}

/** Dark UI crop that sits inside a light grey card. */
function Crop({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mk-dark relative h-[230px] overflow-hidden rounded-[16px] bg-surface-1 shadow-[0_20px_40px_-20px_rgb(0_0_0/.5)] ${className}`}>{children}</div>
  );
}

/* 1. Captions that pop */
function CaptionsDemo() {
  const { ref, live } = useDemo();
  const lit = useTicker(4, 470, live);
  const tiles: { frame: string; words: string[]; style: "pop" | "box" | "clean"; name: string }[] = [
    { frame: "/landing/hero-2.jpg", words: ["wait", "for", "the", "end"], style: "pop", name: "Pop" },
    { frame: "/landing/podcast.jpg", words: ["he", "really", "said", "that"], style: "box", name: "Boxed" },
    { frame: "/landing/vlog.jpg", words: ["nobody", "told", "me", "this"], style: "clean", name: "Clean" },
  ];
  return (
    <div ref={ref} className="mk-motion" data-live={live}>
      <Crop className="grid grid-cols-3 items-center gap-2 px-3">
        {tiles.map((t, i) => (
          <div key={t.name} className={`flex min-w-0 flex-col items-center gap-2 ${i === 1 ? "-translate-y-2" : ""}`}>
            <div className="relative aspect-[9/16] w-full max-w-[78px] overflow-hidden rounded-[8px] bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]">
              <img src={t.frame} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
              <div className="absolute inset-x-1.5 top-[56%]">
                <Caption words={t.words} lit={lit} style={t.style} size={11} />
              </div>
            </div>
            <span className={`text-[11px] ${i === 0 ? "text-text-1" : "text-text-3"}`}>{t.name}</span>
          </div>
        ))}
      </Crop>
    </div>
  );
}

/* 2. Music on the beat: a cut slides and snaps to the nearest beat */
function MusicDemo() {
  const { ref, live } = useDemo();
  const snapped = useTicker(2, 1400, live) === 1;
  return (
    <div ref={ref} className="mk-motion" data-live={live}>
      <Crop className="flex flex-col justify-center gap-2 px-5">
        <div className="tabular mb-1 flex justify-between font-mono text-[10px] text-text-4">
          <span>Drift · 128 BPM</span>
          <span className={snapped ? "text-track-music-wave" : ""}>{snapped ? "cut snapped to beat" : "placing cut…"}</span>
        </div>
        <div className="relative h-11 overflow-hidden rounded-[6px] bg-track-video">
          <div className="absolute inset-y-0 left-0 flex w-full gap-px">
            {Array.from({ length: 8 }).map((_, i) => (
              <img key={i} src={`/landing/hero-${i}.jpg`} alt="" className="h-full flex-1 object-cover opacity-70" />
            ))}
          </div>
          <span
            className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_10px_rgb(255_255_255/.8)] transition-[left] duration-500 ease-[var(--ease)]"
            style={{ left: snapped ? "50%" : "46.5%" }}
          />
        </div>
        <div className="relative h-11 overflow-hidden rounded-[6px] bg-track-music">
          <div className="flex h-full items-center gap-[2px] px-1">
            {Array.from({ length: 56 }).map((_, i) => (
              <span key={i} className="flex-1 rounded-full bg-track-music-wave/85" style={{ height: `${(20 + Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.31)) * 75).toFixed(1)}%` }} />
            ))}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-5 bottom-[calc(50%-58px)] top-[calc(50%-46px)]">
          {Array.from({ length: 9 }).map((_, i) => (
            <span
              key={i}
              className="mk-tick absolute inset-y-0 w-px"
              style={{ left: `${i * 12.5}%`, background: i % 4 === 0 ? "var(--downbeat)" : "var(--beat)", animationDuration: "469ms" }}
            />
          ))}
        </div>
      </Crop>
    </div>
  );
}

/* 3. Transitions that hit */
function TransitionsDemo() {
  const { ref, live } = useDemo();
  const kinds = ["Whip pan", "Punch zoom", "Flash"];
  const k = useTicker(3, 1500, live);
  const frame = useTicker(2, 1500, live);
  return (
    <div ref={ref} className="mk-motion" data-live={live}>
      <Crop className="flex items-center justify-center gap-4 px-4">
        <div className="relative aspect-[9/16] h-[180px] shrink-0 overflow-hidden rounded-[10px] bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]">
          <img
            key={`${k}-${frame}`}
            src={`/landing/hero-${frame ? 6 : 1}.jpg`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ animation: live ? `mk-tr-${k} 700ms var(--ease) both` : undefined }}
          />
          {k === 2 && live && <div key={`f${frame}`} className="absolute inset-0 bg-white" style={{ animation: "mk-tr-flash 600ms ease-out both" }} />}
        </div>
        <ul className="space-y-2 text-[12px]">
          {kinds.map((name, i) => (
            <li key={name} className={`flex items-center gap-2 transition-colors duration-300 ${i === k ? "text-text-1" : "text-text-3"}`}>
              <span className={`size-2 rotate-45 rounded-[2px] ${i === k ? "bg-track-transition-ink" : "bg-text-4"}`} />
              {name}
            </li>
          ))}
        </ul>
        <style>{`
          @keyframes mk-tr-0 { from { transform: translateX(40%); filter: blur(8px); } to { transform: none; filter: none; } }
          @keyframes mk-tr-1 { from { transform: scale(1.35); } to { transform: scale(1); } }
          @keyframes mk-tr-2 { from { opacity: .4; } to { opacity: 1; } }
          @keyframes mk-tr-flash { from { opacity: .7; } to { opacity: 0; } }
        `}</style>
      </Crop>
    </div>
  );
}

/* 4. Sound effects that land */
function SfxDemo() {
  const { ref, live } = useDemo();
  const shown = useTimedProgress(4, live, 450, 300);
  const sfx: [string, string, number][] = [
    ["💥", "Boom", 12],
    ["📀", "Scratch", 36],
    ["🔔", "Ding", 58],
    ["😂", "Laugh", 80],
  ];
  return (
    <div ref={ref} className="mk-motion" data-live={live}>
      <Crop className="flex flex-col justify-center gap-2 px-5">
        <div className="relative h-7">
          {sfx.map(([e, name, x], i) =>
            i < shown ? (
              <span
                key={name}
                className="mk-pop absolute top-0 inline-flex h-6 items-center gap-1 rounded-full bg-track-sfx px-1.5 text-[10px] font-medium text-track-sfx-ink"
                style={{ left: `${x}%`, transform: "translateX(-30%)" }}
              >
                {e}<span className="hidden 2xl:inline"> {name}</span>
              </span>
            ) : null,
          )}
        </div>
        <div className="flex h-12 gap-px overflow-hidden rounded-[6px] bg-track-video">
          {Array.from({ length: 8 }).map((_, i) => (
            <img key={i} src={`/landing/hero-${(i + 2) % 9}.jpg`} alt="" className="h-full flex-1 object-cover opacity-70" />
          ))}
        </div>
        <div className="relative h-4">
          {sfx.map(([, name, x], i) => (
            <span key={name} className={`tabular absolute font-mono text-[10px] transition-opacity duration-300 ${i < shown ? "text-text-3" : "opacity-0"}`} style={{ left: `${x}%` }}>
              0:0{Math.round(x / 12)}
            </span>
          ))}
        </div>
        <p className="mt-1 font-mono text-[10px] text-text-4">{shown}/4 placed on the action, none on the dialogue</p>
      </Crop>
    </div>
  );
}

/* 5. Copy any style */
function StyleDemo() {
  const { ref, live } = useDemo();
  const url = "short-form video link · /v/7341…";
  const n = useTimedProgress(url.length, live);
  const rows = useTimedProgress(4, live && n >= url.length, 380, 200);
  const profile: [string, string][] = [
    ["Cut rate", "every 0.9s"],
    ["Captions", "bold caps · yellow pop"],
    ["Zooms", "6 punch-ins per 10s"],
    ["Music", "140 BPM · high energy"],
  ];
  return (
    <div ref={ref} className="mk-motion" data-live={live}>
      <Crop className="flex flex-col justify-center gap-3 px-5">
        <div className="flex items-center gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[13px] text-text-2 mk-hair">
          <IconLink size={14} className="shrink-0 text-text-3" />
          <span className="truncate">{url.slice(0, n)}</span>
          {n < url.length && <span className="mk-caret -ml-1 h-4 w-px bg-accent" />}
        </div>
        <div className="rounded-[12px] bg-surface-2 p-3 mk-hair">
          <p className="mb-2 flex items-center justify-between text-[11px] text-text-3">
            <span>Style profile</span>
            {rows < 4 ? <span className="mk-shimmer-agent">reading…</span> : <span className="text-text-2">ready to apply</span>}
          </p>
          <dl className="space-y-1.5">
            {profile.map(([k, v], i) => (
              <div key={k} className={`flex justify-between text-[12px] transition-opacity duration-300 ${i < rows ? "opacity-100" : "opacity-0"}`}>
                <dt className="text-text-3">{k}</dt>
                <dd className="text-text-1">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Crop>
    </div>
  );
}

/* 6. Change anything by chat */
function ChatDemo() {
  const { ref, live } = useDemo();
  const s = useTimedProgress(3, live, 800, 400);
  return (
    <div ref={ref} className="mk-motion" data-live={live}>
      <Crop className="flex flex-col justify-center gap-2.5 px-5 text-[13px]">
        <div className="ml-auto max-w-[80%] rounded-[12px] rounded-br-[4px] bg-surface-2 px-3 py-2 text-text-1 mk-hair">Faster cuts and bigger captions</div>
        {s >= 1 && (
          <div className="flex items-center gap-2 text-[12px]">
            <span className="size-1.5 rounded-full bg-agent" />
            {s < 2 ? <span className="mk-shimmer-agent">Working…</span> : <span className="text-text-3">Updated the edit · ran 4 steps</span>}
          </div>
        )}
        {s >= 2 && (
          <div className="mk-pop rounded-[12px] bg-surface-2 p-3 mk-hair" style={{ animationDuration: "380ms" }}>
            <p className="text-text-1">
              Cuts are <b className="font-medium">1.4×</b> faster and captions are <b className="font-medium">120%</b> bigger.
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-text-3">cuts 1.4× · captions 120% · 2 sfx removed</p>
            <div className={`mt-2.5 flex gap-1.5 transition-opacity duration-300 ${s >= 3 ? "opacity-100" : "opacity-0"}`}>
              <span className="inline-flex h-7 items-center gap-1 rounded-[8px] bg-primary-btn px-2.5 text-[12px] font-medium text-primary-btn-ink">
                <IconCheck size={12} /> Keep
              </span>
              <span className="inline-flex h-7 items-center rounded-[8px] bg-surface-3 px-2.5 text-[12px] text-text-2 mk-hair">Revert</span>
            </div>
          </div>
        )}
      </Crop>
    </div>
  );
}

type Feature = { title: string; body: string; demo: ReactNode };
const FOUR: Feature[] = [
  { title: "Captions that pop", body: "Word by word, timed to your voice, key words lit.", demo: <CaptionsDemo /> },
  { title: "Music on the beat", body: "A track that fits the energy, every cut on the beat.", demo: <MusicDemo /> },
  { title: "Transitions that hit", body: "Whip pans, punch zooms and flashes where the action turns.", demo: <TransitionsDemo /> },
  { title: "Sound effects that land", body: "Booms and dings on the moments that earn them.", demo: <SfxDemo /> },
];
const TWO: Feature[] = [
  { title: "Copy any style", body: "Paste a link to a video you like. Unfold reads its pacing, captions, zooms and music, then edits yours the same way.", demo: <StyleDemo /> },
  { title: "Change anything by chat", body: "“Faster cuts.” “Bigger captions.” Say what you want to change and Unfold reworks the edit.", demo: <ChatDemo /> },
];

function ArrowButton({ href = "/app" }: { href?: string }) {
  return (
    <Link href={href} aria-label="Start editing" className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-surface-1 text-text-1 shadow-[var(--shadow-raised)] transition-transform duration-200 ease-[var(--ease)] hover:translate-x-0.5">
      <IconArrowRight size={16} />
    </Link>
  );
}

function Card({ f, big }: { f: Feature; big?: boolean }) {
  return (
    <div className={`mk-card flex flex-col p-5 sm:p-6 ${big ? "lg:p-8" : ""}`}>
      <div className={`flex items-start justify-between gap-4 ${big ? "" : "xl:min-h-[94px]"}`}>
        <h3 className={`font-medium tracking-[-0.03em] text-text-1 ${big ? "text-[28px] leading-[1.1] lg:text-[32px]" : "text-[28px] leading-[1.1]"}`}>{f.title}</h3>
        <ArrowButton />
      </div>
      <div className={big ? "mt-8 lg:mt-10" : "mt-6"}>{f.demo}</div>
      <p className={`mt-5 text-[15px] leading-6 text-text-2 ${big ? "max-w-[460px]" : ""}`}>{f.body}</p>
    </div>
  );
}

export function Features() {
  return (
    <section id="styles" className="mk-section scroll-mt-16">
      <div className="mk-container">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mk-label">What Unfold does</p>
            <h2 className="mk-title mt-3 max-w-[640px]">
              Everything a viral edit needs, <em>done</em> for you.
            </h2>
            <p className="mt-4 text-[15px] leading-6 text-text-2">One polished edit, with every layer working together. Illustrative previews below.</p>
          </div>
          <ButtonLink href="/app" variant="secondary" size="lg" className="self-start md:self-auto">
            Start editing <IconArrowRight size={15} />
          </ButtonLink>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4 lg:mt-16">
          {FOUR.map((f) => (
            <Card key={f.title} f={f} />
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {TWO.map((f) => (
            <Card key={f.title} f={f} big />
          ))}
        </div>
        <AltVersionsCard />
      </div>
    </section>
  );
}

/* Alternate versions: a secondary feature, a slim wide card. */
const VERSIONS = [
  { words: ["41", "kills", "one", "game"], hot: [0, 3], style: "pop" as const, meta: "hook A · pop" },
  { words: ["watch", "the", "last", "kill"], hot: [3], style: "box" as const, meta: "hook B · boxed" },
  { words: ["bro", "what"], hot: [1], style: "chaos" as const, meta: "hook C · chaos" },
];

function AltVersionsCard() {
  return (
    <div className="mk-card mt-4 grid items-center gap-8 p-5 sm:p-6 md:grid-cols-[1fr_1.1fr] lg:p-8">
      <div>
        <p className="mk-label">Alternate versions</p>
        <h3 className="mt-3 text-[28px] font-medium leading-[1.1] tracking-[-0.03em] text-text-1 lg:text-[34px]">Not sure which hook works? Try three.</h3>
        <p className="mt-3 max-w-[420px] text-[15px] leading-6 text-text-2">Explore a different opening, track or caption style. Start with one edit, then try another direction.</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {VERSIONS.map((v, i) => (
          <PreviewCard
            key={v.meta}
            src={CLIPS.gaming.src}
            poster={CLIPS.gaming.poster}
            meta={v.meta}
            className={`${i === 0 ? "shadow-[0_0_0_2px_var(--accent)]" : ""} max-h-[300px]`}
            overlay={
              <div className="pointer-events-none absolute inset-x-2 top-[46%]">
                <Caption words={v.words} hot={v.hot} style={v.style} size={16} />
              </div>
            }
          />
        ))}
      </div>
    </div>
  );
}
