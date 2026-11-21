/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { PromptBox } from "./PromptBox";
import { HeroThumbs } from "./Showcase";
import { UnfoldReveal } from "./UnfoldReveal";
import { PhoneTile } from "./PhoneTile";
import { DEMO_VARIANTS } from "./variants";
import { SHOWCASE } from "./showcase-clips";
import {
  IconArrowRight,
  IconCaptions,
  IconCopy,
  IconCut,
  IconGrid,
  IconHook,
  IconMusic,
  IconSparkle,
  IconSpeaker,
  IconUpload,
} from "./icons";

/* ---------- shared bits ---------- */

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <img src="/logo-mark.svg" alt="" width={34} height={30} className="-ml-1 h-[30px] w-[34px]" />
      <span className="font-display text-[22px] font-extrabold leading-none tracking-[-0.03em] text-ink">unfold</span>
    </span>
  );
}

function Eyebrow({ children, tone = "flare" }: { children: ReactNode; tone?: "flare" | "violet" }) {
  return (
    <p className={`font-mono text-[11px] font-medium uppercase tracking-[.08em] ${tone === "flare" ? "text-flare" : "text-violet"}`}>
      {children}
    </p>
  );
}

function SectionHead({ eyebrow, title, sub, tone }: { eyebrow: string; title: ReactNode; sub?: string; tone?: "flare" | "violet" }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      <h2 className="mt-3 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink sm:text-[48px]">{title}</h2>
      {sub && <p className="mx-auto mt-4 max-w-xl text-[15px] leading-6 text-ink-muted sm:text-[17px] sm:leading-7">{sub}</p>}
    </div>
  );
}

/* ---------- nav ---------- */

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-bg/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Unfold home">
          <Logo />
        </Link>
        <div className="hidden items-center gap-7 text-[14px] text-ink-muted md:flex">
          <a href="#how" className="transition-colors hover:text-ink">How it works</a>
          <a href="#agent" className="transition-colors hover:text-ink">The agent</a>
          <a href="#speed" className="transition-colors hover:text-ink">Speed</a>
          <a href="#faq" className="transition-colors hover:text-ink">FAQ</a>
        </div>
        <Link
          href="/app"
          className="inline-flex h-9 items-center rounded-xl bg-ink px-4 text-[14px] font-semibold text-bg transition-opacity hover:opacity-90"
        >
          Unfold a clip
        </Link>
      </nav>
    </header>
  );
}

/* ---------- hero ---------- */

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pb-14 pt-10 sm:px-6 md:pb-24 md:pt-16">
      <div className="mk-dots pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        <div className="min-w-0">
          <HeroThumbs />
          <h1
            className="mt-5 font-display text-[44px] font-extrabold leading-[1] tracking-[-0.035em] text-ink sm:text-[60px] lg:text-[72px] lg:leading-[76px]"
          >
            Turn one clip into every version that could <span className="mk-gradient-text">go viral.</span>
          </h1>
          <p
            className="mt-5 max-w-xl text-[16px] leading-7 text-ink-muted sm:text-[18px]"
          >
            Upload a raw clip. An agent adds captions, beat-synced music, transitions and meme sounds, nine different ways,
            in seconds. Chat to remix, or copy the style of any video you link.
          </p>
          <div className="mt-7 max-w-xl">
            <PromptBox />
          </div>
          <p className="mt-4 text-[12px] text-ink-muted">Gameplay, vlogs, talking heads, podcasts. Up to 3 minutes.</p>
        </div>
        <div className="min-w-0">
          <UnfoldReveal />
        </div>
      </div>
    </section>
  );
}

/* ---------- marquee strip ---------- */

const STRIP = ["Gaming montages", "Podcast clips", "Storytimes", "Vlogs", "Talking heads", "Brainrot edits", "Reaction clips", "Tutorials"];

export function Strip() {
  const items = [...STRIP, ...STRIP];
  return (
    <div className="overflow-hidden border-y border-border bg-surface py-4" aria-hidden>
      <div className="mk-marquee flex w-max gap-10 whitespace-nowrap">
        {items.map((s, i) => (
          <span key={i} className="flex items-center gap-10 font-display text-[18px] font-bold tracking-[-0.01em] text-ink-muted">
            {s}
            <span className="size-1.5 rounded-full bg-flare" />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- how it works ---------- */

const STEPS = [
  {
    n: "01",
    icon: IconUpload,
    title: "Upload",
    body: "Drop a raw clip and say what you want. Pick a preset or paste a video whose style you like.",
    visual: (
      <div className="flex h-full items-center justify-center">
        <div className="flex w-[78%] items-center gap-3 rounded-xl border border-dashed border-border bg-bg px-3 py-3">
          <div className="relative h-12 w-[27px] shrink-0 overflow-hidden rounded-md bg-black">
            <img src="/landing/gaming.jpg" alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-ink">solo_match_raw.mp4</div>
            <div className="mt-1.5 h-1.5 rounded-full bg-surface-2">
              <div className="h-full w-[72%] rounded-full bg-flare" />
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    n: "02",
    icon: IconSparkle,
    title: "Unfold decides",
    body: "The agent watches the clip, finds the hook and the beat, then writes nine complete edits.",
    visual: (
      <div className="flex h-full flex-col justify-center gap-1.5 px-5">
        {[
          ["hook", "0:07 “wait for it”", "#FFE14D"],
          ["music", "phonk · 128 bpm", "#2F80ED"],
          ["sfx", "bass boom @ 0:11", "#FF4FA3"],
          ["cut", "whip pan × 4", "#FFB020"],
        ].map(([k, v, c]) => (
          <div key={k} className="flex items-center gap-2 rounded-md bg-bg px-2.5 py-1.5 font-mono text-[11px]">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: c }} />
            <span className="w-10 text-ink-muted">{k}</span>
            <span className="truncate text-ink">{v}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    n: "03",
    icon: IconGrid,
    title: "Pick and post",
    body: "Scroll nine finished edits. Keep the best, remix it in chat, export in 9:16.",
    visual: (
      <div className="flex h-full items-center justify-center gap-2">
        {DEMO_VARIANTS.slice(0, 3).map((v, i) => (
          <div
            key={i}
            className={`relative aspect-[9/16] w-[22%] overflow-hidden rounded-lg ${i === 1 ? "scale-110 ring-2 ring-flare" : "opacity-70"}`}
          >
            <PhoneTile v={v} />
          </div>
        ))}
      </div>
    ),
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 px-4 py-14 sm:px-6 md:py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHead eyebrow="How it works" title="Upload. Unfold. Post." sub="No timeline to learn. You describe the vibe, the agent does the editing, you choose the winner." />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="h-40 border-b border-border bg-surface-2">{s.visual}</div>
              <div className="p-5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-ink-muted">{s.n}</span>
                  <s.icon size={16} className="text-ink" />
                </div>
                <h3 className="mt-2 font-display text-[22px] font-bold tracking-[-0.01em] text-ink">{s.title}</h3>
                <p className="mt-1.5 text-[14px] leading-[22px] text-ink-muted">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- what the agent decides (bento) ---------- */

function Card({ icon: Icon, title, body, children, className = "" }: {
  icon: (p: { size?: number; className?: string }) => ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border border-border bg-surface ${className}`}>
      {children && <div className="relative min-h-36 flex-1 border-b border-border bg-surface-2">{children}</div>}
      <div className="p-5">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-violet/10 text-violet">
            <Icon size={15} />
          </span>
          <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
        </div>
        <p className="mt-2 text-[14px] leading-[22px] text-ink-muted">{body}</p>
      </div>
    </div>
  );
}

export function AgentDecides() {
  return (
    <section id="agent" className="scroll-mt-20 px-4 py-14 sm:px-6 md:py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHead
          eyebrow="What the agent decides"
          tone="violet"
          title="Every creative call, made for you."
          sub="Unfold doesn't apply a template. It reads your clip, then picks what fits: per moment, per variant."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-6">
          <Card icon={IconCaptions} title="Captions that pop" body="Word-by-word captions, one to three words per beat, emphasis words in yellow." className="md:col-span-3">
            <div className="absolute inset-0 flex items-center justify-center bg-[#0b0b0c]">
              <img src="/landing/hero-4.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />
              <div className="mk-caption relative text-center text-[34px] sm:text-[42px]">
                he hit the <span className="text-caption-yellow">360</span>
              </div>
            </div>
          </Card>

          <Card icon={IconMusic} title="Beat-synced music" body="Picks a track that matches the energy, then snaps every cut to the beat." className="md:col-span-3">
            <div className="absolute inset-0 flex flex-col justify-center gap-3 px-6">
              <div className="flex h-14 items-center gap-[3px]">
                {Array.from({ length: 48 }).map((_, i) => (
                  <span
                    key={i}
                    className={`flex-1 rounded-full ${i % 6 === 0 ? "mk-beat bg-track-music" : "bg-track-music/35"}`}
                    style={{ height: `${30 + Math.abs(Math.sin(i * 1.7)) * 70}%`, "--i": i % 8 } as CSSProperties}
                  />
                ))}
              </div>
              <div className="relative h-6 rounded-md bg-track-video/80">
                {[8, 21, 33, 46, 58, 71, 83, 95].map((x) => (
                  <span key={x} className="absolute top-0 h-full w-[2px] bg-track-beat" style={{ left: `${x}%` }} />
                ))}
              </div>
              <div className="flex justify-between font-mono text-[10px] text-ink-muted">
                <span>phonk_drift.mp3</span>
                <span>128 bpm · 8 cuts on beat</span>
              </div>
            </div>
          </Card>

          <Card icon={IconCut} title="Transitions" body="Whip pans, zoom punches and hard cuts, placed where the action turns." className="md:col-span-2">
            <div className="absolute inset-0 flex items-center justify-center gap-2 px-5">
              {["zoom", "whip", "cut", "glitch"].map((t, i) => (
                <span key={t} className="flex flex-col items-center gap-1.5">
                  <span className="grid size-10 rotate-45 place-items-center rounded-md border-2 border-track-transition bg-track-transition/15" style={{ opacity: 1 - i * 0.15 }} />
                  <span className="font-mono text-[10px] text-ink-muted">{t}</span>
                </span>
              ))}
            </div>
          </Card>

          <Card icon={IconSpeaker} title="Meme sounds" body="Bass booms, record scratches and dings, timed to the moment, never spammed." className="md:col-span-2">
            <div className="absolute inset-0 flex flex-wrap content-center items-center justify-center gap-2 px-5">
              {["💥 boom", "🎺 airhorn", "📀 scratch", "🔔 ding", "💨 whoosh"].map((s) => (
                <span key={s} className="rounded-lg bg-track-sfx/15 px-2.5 py-1 text-[12px] font-medium text-track-sfx">{s}</span>
              ))}
            </div>
          </Card>

          <Card icon={IconHook} title="Hooks" body="Finds the strongest two seconds and opens on them, with a hook line to match." className="md:col-span-2">
            <div className="absolute inset-0 flex flex-col justify-center gap-2 px-5">
              <div className="relative h-7 overflow-hidden rounded-md bg-track-video/80">
                <span className="absolute inset-y-0 left-[62%] w-[14%] rounded-sm bg-caption-yellow/90" />
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                <IconArrowRight size={12} className="rotate-180" /> moved 0:41 → 0:00
              </div>
              <div className="rounded-md bg-bg px-2.5 py-1.5 text-[12px] text-ink">“wait for the ending”</div>
            </div>
          </Card>

          <Card icon={IconCopy} title="Copy any style from a link" body="Paste a link to any short-form video. Unfold reads its cut rate, caption look, zooms, sound density and music energy, then applies that style to your clip." className="md:col-span-6">
            <div className="absolute inset-0 flex items-center justify-center gap-3 p-5 sm:gap-6">
              <div className="flex min-w-0 max-w-[260px] flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
                <span className="shrink-0 text-violet"><IconCopy size={14} /></span>
                <span className="truncate font-mono text-[11px] text-ink-muted">link to a vertical video…</span>
              </div>
              <IconArrowRight size={16} className="hidden shrink-0 text-ink-muted sm:block" />
              <div className="hidden flex-wrap gap-1.5 sm:flex">
                {["cut every 0.9s", "bold caps · yellow pop", "punch zooms", "high SFX", "140 bpm"].map((t) => (
                  <span key={t} className="rounded-md bg-violet/10 px-2 py-1 font-mono text-[11px] text-violet">{t}</span>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

/* ---------- variants / A-B hooks ---------- */

const AB = [
  { tag: "A", v: DEMO_VARIANTS[0], line: "Opens on the clutch, phonk at 128 bpm, yellow pop captions." },
  { tag: "B", v: DEMO_VARIANTS[1], line: "Slow build, storytime voice-over captions, lo-fi bed." },
  { tag: "C", v: DEMO_VARIANTS[2], line: "Cuts every 0.8s, meme sounds on every beat, 12 seconds." },
];

export function Variants() {
  return (
    <section className="px-4 py-14 sm:px-6 md:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Eyebrow>Variants</Eyebrow>
          <h2 className="mt-3 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink sm:text-[48px]">
            Post three hooks. Keep the one that holds.
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-6 text-ink-muted sm:text-[17px] sm:leading-7">
            Nobody knows which edit will hit. So don&apos;t guess. Every variant changes the hook, cut order, track, caption
            style and length, so you can A/B test real alternatives, not nine copies of one idea.
          </p>
          <ul className="mt-6 space-y-2.5 text-[14px] text-ink">
            {["Different opening line on every variant", "Lengths from 12s to 45s", "Remix any one in chat: “faster”, “fewer sounds”"].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-flare" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {AB.map(({ tag, v, line }) => (
            <div key={tag} className="min-w-0">
              <div className="relative aspect-[9/16] overflow-hidden rounded-[20px] border border-border shadow-[0_20px_40px_-24px_rgb(0_0_0/.5)]">
                <PhoneTile v={v} size="md" />
                <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-white font-display text-[14px] font-extrabold text-[#0b0b0c]">
                  {tag}
                </span>
              </div>
              <p className="mt-3 hidden text-[13px] leading-5 text-ink-muted sm:block">{line}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */

const FAQS = [
  ["What kind of clips work?", "Anything with a moment worth watching: gameplay, vlogs, talking heads, podcasts, reactions. Vertical or horizontal, up to about three minutes. Unfold exports 9:16."],
  ["How does copying a style from a link work?", "Paste a link to any public short-form video. Unfold samples its frames and audio, measures cut rate, caption font and colour, zooms, transitions, sound effect density and music energy, then applies that profile to your clip. It copies the style, not the content."],
  ["Where does the music come from?", "A library of royalty-free tracks, tagged by mood and BPM, so the agent can match energy and cut on the beat."],
  ["Can I change what the agent did?", "Yes. Chat to remix (“faster pacing”, “less meme sounds”) and it re-plans in under a second. Or open the editor and adjust captions, music, sounds and transitions on the timeline."],
  ["Why is it so fast?", "The agent runs Kimi K3.1 Pro on Cerebras at around 700 tokens a second. Planning nine edits takes seconds instead of minutes, so you can iterate as fast as you can type."],
  ["Is this an AI template?", "No. Each edit is planned from your clip: where the hook is, where the beat drops, which words to emphasise. Two clips with the same preset get different edits."],
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 px-4 py-14 sm:px-6 md:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="mt-3 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink sm:text-[48px]">Questions, answered.</h2>
        </div>
        <div className="divide-y divide-border border-y border-border">
          {FAQS.map(([q, a]) => (
            <details key={q} className="mk-faq group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[16px] font-medium text-ink">
                {q}
                <span className="mk-faq-icon grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-muted transition-transform duration-[240ms]">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </span>
              </summary>
              <p className="-mt-1 max-w-2xl pb-5 pr-10 text-[15px] leading-6 text-ink-muted">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- final CTA + footer ---------- */

export function FinalCta() {
  return (
    <section className="px-4 pb-14 sm:px-6 md:pb-24">
      <div className="mk-gradient relative mx-auto max-w-6xl overflow-hidden rounded-3xl px-6 py-16 text-center sm:py-20">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgb(255_255_255/.25),transparent)]" />
        <h2 className="relative mx-auto max-w-3xl font-display text-[38px] font-extrabold leading-[1.02] tracking-[-0.03em] text-white sm:text-[60px]">
          One raw clip. Nine viral edits. Under ten seconds.
        </h2>
        <p className="relative mx-auto mt-4 max-w-md text-[16px] leading-7 text-white/85">Bring the clip you were going to post anyway.</p>
        <Link
          href="/app"
          className="group relative mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-[#0b0b0c] transition-transform duration-[120ms] hover:scale-[1.02] active:scale-[.98]"
        >
          Unfold a clip
          <IconArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo />
          <p className="mt-2 text-[13px] text-ink-muted">Built with Kimi K3.1 Pro on Cerebras · OpenClaw. #KimiOnCerebras</p>
          <p className="mt-2 max-w-xl text-[11px] leading-4 text-ink-muted/80">
            Example clips (CC BY):{" "}
            {SHOWCASE.map((c, i) => (
              <span key={c.slug}>
                <a href={c.credit.url} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-2 hover:text-ink">
                  {c.credit.name}
                </a>
                {i < SHOWCASE.length - 1 ? ", " : "."}
              </span>
            ))}{" "}
            Captions and edits are illustrative.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-muted">
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#speed" className="hover:text-ink">Speed</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
          <Link href="/app" className="hover:text-ink">Open the app</Link>
        </div>
      </div>
    </footer>
  );
}

