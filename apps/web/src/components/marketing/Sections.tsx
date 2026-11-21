import Link from "next/link";
import type { CSSProperties } from "react";
import { PromptBox } from "./PromptBox";
import { HeroThumbs } from "./Showcase";
import { PhoneTile } from "./PhoneTile";
import { DEMO_VARIANTS } from "./variants";
import { SHOWCASE } from "./showcase-clips";
import { Accent, CONTAINER, Eyebrow, H2, Logo, SECTION_Y } from "./ui";
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

function d(ms: number, y?: string) {
  return { "--d": `${ms}ms`, ...(y ? { "--y": y } : {}) } as CSSProperties;
}

/* ---------- nav ---------- */

export function Nav() {
  return (
    <header className="mk-hair-bottom sticky top-0 z-40 bg-bg/80 backdrop-blur-md">
      <nav className={`${CONTAINER} flex h-12 items-center justify-between`}>
        <Link href="/" aria-label="Unfold home">
          <Logo />
        </Link>
        <div className="mk-t2 hidden items-center gap-6 text-[13px] md:flex">
          <a href="#examples" className="hover:text-ink">Examples</a>
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#speed" className="hover:text-ink">Speed</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
        </div>
        <Link
          href="/app"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-flare px-3 text-[13px] font-medium text-flare-ink transition-[filter] duration-150 hover:brightness-110"
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
    <section className="relative overflow-hidden pb-16 pt-14 md:pb-24 md:pt-24">
      <div className="mk-aurora pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[640px]" />
      <div className={`${CONTAINER} flex flex-col items-center text-center`}>
        <div className="mk-blur-in" style={d(600, "-10px")}>
          <HeroThumbs />
        </div>
        <h1
          className="mk-blur-in mt-7 max-w-4xl text-[44px] font-light leading-[0.98] tracking-[-0.045em] text-balance text-ink sm:text-[64px] lg:text-[80px] lg:leading-[0.95]"
          style={d(0)}
        >
          Turn one clip into every version that could <Accent>go viral.</Accent>
        </h1>
        <p className="mk-blur-in mk-t2 mt-6 max-w-xl text-[17px] leading-7 text-balance sm:text-lg" style={d(150)}>
          Upload a raw clip. An agent adds captions, beat-synced music, transitions and meme sounds, nine different ways, in
          seconds. Chat to remix, or copy the style of any video you link.
        </p>
        <div className="mk-blur-in mt-9 w-full max-w-2xl" style={d(400, "10px")}>
          <PromptBox />
        </div>
        <p className="mk-t3 mt-4 text-[12px]">Gameplay, vlogs, talking heads, podcasts. Up to 3 minutes.</p>
      </div>
    </section>
  );
}

/* ---------- how it works ---------- */

const STEPS = [
  { n: "01", icon: IconUpload, title: "Upload", body: "Drop a raw clip and say what you want. Pick a preset, or paste a video whose style you like." },
  { n: "02", icon: IconSparkle, title: "Unfold decides", body: "The agent watches the clip, finds the hook and the beat, then writes nine complete edits." },
  { n: "03", icon: IconGrid, title: "Pick and post", body: "Scroll nine finished edits. Keep the best, remix it in chat, export in 9:16." },
];

export function HowItWorks() {
  return (
    <section id="how" className={`mk-band scroll-mt-12 ${SECTION_Y}`}>
      <div className={CONTAINER}>
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between md:gap-12">
          <div>
            <Eyebrow>How it works</Eyebrow>
            <h2 className={`${H2} mt-4`}>
              Upload. Unfold. <Accent>Post.</Accent>
            </h2>
          </div>
          <p className="mk-t2 max-w-sm text-[15px] leading-6 text-balance">
            No timeline to learn. You describe the vibe, the agent does the editing, you choose the winner.
          </p>
        </div>
        <div className="mt-16 grid gap-x-16 gap-y-12 md:mt-20 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="mk-hair-top pt-6">
              <div className="flex items-center gap-3">
                <span className="mk-t4 font-mono text-[12px]">{s.n}</span>
                <s.icon size={16} className="mk-t2" />
              </div>
              <h3 className="mt-5 text-[20px] font-normal tracking-[-0.01em] text-ink">{s.title}</h3>
              <p className="mk-t2 mt-2 text-[15px] leading-6 text-balance">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- what the agent decides (text-only grid) ---------- */

const DECIDES = [
  { icon: IconCaptions, title: "Captions that pop", body: "Word-by-word, one to three words per beat, with the emphasis word in caption yellow." },
  { icon: IconMusic, title: "Beat-synced music", body: "Picks a track that matches the energy, then snaps every cut to the beat." },
  { icon: IconCut, title: "Transitions", body: "Whip pans, punch zooms and hard cuts, placed where the action turns." },
  { icon: IconSpeaker, title: "Meme sounds", body: "Booms, record scratches and dings, timed to the moment and never spammed." },
  { icon: IconHook, title: "Hooks", body: "Finds the strongest two seconds and opens on them, with a hook line to match." },
  { icon: IconCopy, title: "Copy any style", body: "Paste a link. Unfold reads its cut rate, caption look, zooms and music energy, then applies them to your clip." },
];

export function AgentDecides() {
  return (
    <section id="agent" className={`scroll-mt-12 ${SECTION_Y}`}>
      <div className={CONTAINER}>
        <div className="md:text-right">
          <Eyebrow>What the agent decides</Eyebrow>
          <h2 className={`${H2} mt-4 md:ml-auto md:max-w-3xl`}>
            Every creative call, <Accent>made for you.</Accent>
          </h2>
        </div>
        <div className="mt-16 grid grid-cols-1 gap-x-16 gap-y-12 sm:grid-cols-2 md:mt-24 md:grid-cols-3 md:gap-y-20">
          {DECIDES.map((f) => (
            <div key={f.title}>
              <f.icon size={18} className="mk-t2" />
              <h3 className="mt-4 text-[15px] font-medium tracking-[0.01em] text-ink">{f.title}</h3>
              <p className="mk-t2 mt-2 text-[15px] leading-6 tracking-[0.01em] text-balance">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- variants / A-B hooks ---------- */

const AB = [
  { tag: "A", v: DEMO_VARIANTS[0], line: "Opens on the clutch, 128 bpm, pop captions." },
  { tag: "B", v: DEMO_VARIANTS[1], line: "Slow build, storytime captions, lo-fi bed." },
  { tag: "C", v: DEMO_VARIANTS[2], line: "Cuts every 0.8s, sounds on every beat, 12s." },
];

export function Variants() {
  return (
    <section className={SECTION_Y}>
      <div className={`${CONTAINER} grid items-center gap-16 lg:grid-cols-[1fr_1.1fr] lg:gap-24`}>
        <div>
          <Eyebrow>Variants</Eyebrow>
          <h2 className={`${H2} mt-4`}>
            Post three hooks. Keep the one that <Accent>holds.</Accent>
          </h2>
          <p className="mk-t2 mt-6 max-w-md text-[15px] leading-6 text-balance sm:text-[17px] sm:leading-7">
            Nobody knows which edit will hit, so don&apos;t guess. Every variant changes the hook, cut order, track, caption style
            and length, so you test real alternatives, not nine copies of one idea.
          </p>
          <ul className="mt-8 space-y-3 text-[15px]">
            {["A different opening line on every variant", "Lengths from 12s to 45s", "Remix any one in chat: “faster”, “fewer sounds”"].map((t) => (
              <li key={t} className="flex items-start gap-3 text-ink">
                <span className="mk-t4 font-mono text-[12px] leading-6">—</span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-5">
          {AB.map(({ tag, v, line }, i) => (
            <div key={tag} className="min-w-0" style={{ marginTop: `${i * 24}px` }}>
              <div className="mk-frame mk-dark-frame relative aspect-[9/16] overflow-hidden rounded-xl shadow-[0_24px_48px_-24px_rgb(0_0_0/.5)]">
                <PhoneTile v={v} size="md" />
                <span className="absolute left-2 top-2 z-[3] grid size-6 place-items-center rounded-full bg-white text-[12px] font-semibold text-[#0b0b0c]">
                  {tag}
                </span>
              </div>
              <p className="mk-t3 mt-3 hidden text-[13px] leading-5 sm:block">{line}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ (raised band, no dividers) ---------- */

const FAQS = [
  ["What kind of clips work?", "Anything with a moment worth watching: gameplay, vlogs, talking heads, podcasts, reactions. Vertical or horizontal, up to about three minutes. Unfold exports 9:16."],
  ["How does copying a style from a link work?", "Paste a link to any public short-form video. Unfold samples its frames and audio, measures cut rate, caption font and colour, zooms, transitions, sound effect density and music energy, then applies that profile to your clip. It copies the style, not the content."],
  ["Where does the music come from?", "A library of royalty-free tracks, tagged by mood and BPM, so the agent can match energy and cut on the beat."],
  ["Can I change what the agent did?", "Yes. Chat to remix (“faster pacing”, “less meme sounds”) and it re-plans in under a second. Or open the editor and adjust captions, music, sounds and transitions on the timeline."],
  ["Why is it so fast?", "The agent runs Kimi K3.1 Pro on Cerebras at around 700 tokens a second. Planning nine edits takes seconds instead of minutes, so you can iterate as fast as you can type."],
  ["Is this a template?", "No. Each edit is planned from your clip: where the hook is, where the beat drops, which words to emphasise. Two clips with the same preset get different edits."],
];

export function Faq() {
  return (
    <section id="faq" className="mk-band scroll-mt-12 py-24 md:py-48">
      <div className={`${CONTAINER} grid gap-12 md:grid-cols-[1fr_1.4fr] md:gap-16`}>
        <div>
          <h2 className={H2}>
            Frequently
            <br />
            asked <Accent>questions</Accent>
          </h2>
          <Link href="/app" className="mk-ulink mt-8 text-[15px]">
            Try it on your clip
            <IconArrowRight size={15} />
          </Link>
        </div>
        <div>
          {FAQS.map(([q, a]) => (
            <details key={q} className="mk-faq group">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 text-[17px] text-ink sm:text-lg">
                {q}
                <span className="mk-faq-icon mk-t3 mt-1 shrink-0 transition-transform duration-200">
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                    <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </span>
              </summary>
              <p className="mk-faq-a mk-t2 max-w-2xl pb-6 pr-10 text-[15px] leading-6">{a}</p>
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
    <section className="relative overflow-hidden py-32 md:py-48">
      <div className="mk-aurora pointer-events-none absolute inset-x-0 top-10 -z-10 h-[420px] opacity-70" />
      <div className={`${CONTAINER} flex flex-col items-start md:items-end md:text-right`}>
        <h2 className={`${H2} max-w-3xl`}>
          One raw clip. Nine viral edits.
          <br />
          Under <Accent>ten seconds.</Accent>
        </h2>
        <p className="mk-t2 mt-6 max-w-md text-[17px] leading-7">Bring the clip you were going to post anyway.</p>
        <Link
          href="/app"
          className="group mt-10 inline-flex h-11 items-center gap-2 rounded-lg bg-flare px-6 text-[15px] font-medium text-flare-ink transition-[filter] duration-150 hover:brightness-110"
        >
          Unfold a clip
          <IconArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
        </Link>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="mk-hair-top pb-20 pt-14">
      <div className={`${CONTAINER} flex flex-col gap-12 md:flex-row md:justify-between`}>
        <div className="max-w-sm">
          <Logo />
          <p className="mk-t3 mt-4 text-[13px] leading-5">Built with Kimi K3.1 Pro on Cerebras · OpenClaw. #KimiOnCerebras</p>
          <p className="mk-t4 mt-3 text-[11px] leading-4">
            Example clips (CC BY):{" "}
            {SHOWCASE.map((c, i) => (
              <span key={c.slug}>
                <a href={c.credit.url} target="_blank" rel="noreferrer" className="underline decoration-[var(--mk-line-strong)] underline-offset-2 hover:text-ink">
                  {c.credit.name}
                </a>
                {i < SHOWCASE.length - 1 ? ", " : "."}
              </span>
            ))}{" "}
            Captions and edits are illustrative.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-16 gap-y-3 text-[15px] sm:gap-x-24">
          <div className="flex flex-col gap-3">
            <span className="font-medium text-ink">Product</span>
            <a href="#examples" className="mk-t2 hover:text-ink">Examples</a>
            <a href="#how" className="mk-t2 hover:text-ink">How it works</a>
            <a href="#speed" className="mk-t2 hover:text-ink">Speed</a>
          </div>
          <div className="flex flex-col gap-3">
            <span className="font-medium text-ink">Start</span>
            <Link href="/app" className="mk-t2 hover:text-ink">Open the app</Link>
            <a href="#faq" className="mk-t2 hover:text-ink">FAQ</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
