import Link from "next/link";
import { LoopVideo } from "./LoopVideo";
import { HERO_THUMBS, SHOWCASE, type ShowcaseClip } from "./showcase-clips";
import { IconArrowRight } from "./icons";

function Caption({ c }: { c: ShowcaseClip }) {
  if (!c.caption) return null;
  const [plain, hot] = c.caption;
  switch (c.style) {
    case "box":
      return (
        <div className="flex flex-wrap justify-center gap-1 font-display text-[18px] font-extrabold uppercase leading-none tracking-[-0.01em] sm:text-[24px]">
          <span className="rounded-md bg-black px-2 py-1 text-white">{plain}</span>
          <span className="rounded-md bg-flare px-2 py-1 text-white">{hot}</span>
        </div>
      );
    case "chaos":
      return (
        <div className="mk-caption -rotate-6 text-[30px] sm:text-[42px]" style={{ color: "#FF4FA3" }}>
          {plain} <span className="text-caption-yellow">{hot}</span>
        </div>
      );
    case "clean":
      return (
        <div className="text-[17px] font-semibold leading-tight text-white [text-shadow:0_2px_12px_rgb(0_0_0/.7)] sm:text-[22px]">
          {plain} <span className="text-caption-yellow">{hot}</span>
        </div>
      );
    default:
      return (
        <div className="mk-caption text-[24px] sm:text-[34px]">
          {plain} <span className="text-caption-yellow">{hot}</span>
        </div>
      );
  }
}

function Tile({ c }: { c: ShowcaseClip }) {
  return (
    <figure
      className={`group relative overflow-hidden rounded-2xl bg-[#0b0b0c] ring-1 ring-border ${
        c.wide ? "col-span-2 aspect-video" : "aspect-[9/16] md:aspect-[3/4]"
      }`}
    >
      <LoopVideo src={c.src} poster={c.poster} className="transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />
      <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
        {c.tag}
      </span>
      <div className="mk-pop pointer-events-none absolute inset-x-3 top-[58%] -translate-y-1/2 text-center">
        <Caption c={c} />
      </div>
      <figcaption className="absolute inset-x-3 bottom-3 text-[12px] font-medium text-white/85 sm:text-[13px]">{c.title}</figcaption>
    </figure>
  );
}

export function Showcase() {
  return (
    <section id="examples" className="scroll-mt-20 px-4 pb-14 pt-4 sm:px-6 md:pb-24">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[.08em] text-flare">Made with Unfold</p>
            <h2 className="mt-3 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink sm:text-[48px]">
              Raw clips in. Scroll-stoppers out.
            </h2>
          </div>
          <Link href="/app" className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-ink hover:text-flare">
            Try it on your clip
            <IconArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {SHOWCASE.map((c) => (
            <Tile key={c.slug} c={c} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Row of tiny looping clips above the hero headline. */
export function HeroThumbs() {
  const tilt = ["-rotate-6", "rotate-3", "-rotate-2", "rotate-6"];
  return (
    <div className="flex items-center" aria-hidden>
      {HERO_THUMBS.map((c, i) => (
        <div
          key={c.slug}
          className={`relative -ml-2 h-14 w-10 overflow-hidden rounded-lg bg-[#0b0b0c] shadow-[0_6px_16px_-6px_rgb(0_0_0/.5)] ring-2 ring-bg first:ml-0 sm:h-16 sm:w-[46px] ${tilt[i % 4]}`}
        >
          <LoopVideo src={c.src} poster={c.poster} />
        </div>
      ))}
      <span className="ml-3 flex flex-col text-[12px] leading-4 text-ink-muted">
        <span className="font-medium text-ink">Made from raw clips</span>
        <span>Kimi K3.1 Pro on Cerebras · OpenClaw</span>
      </span>
    </div>
  );
}
