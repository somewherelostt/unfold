import Link from "next/link";
import { LoopVideo } from "./LoopVideo";
import { HERO_THUMBS, SHOWCASE, type ShowcaseClip } from "./showcase-clips";
import { IconArrowRight } from "./icons";
import { Accent, CONTAINER, Eyebrow, H2, SECTION_Y } from "./ui";

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
      className={`mk-frame mk-dark-frame group relative overflow-hidden rounded-xl bg-[#0b0b0c] ${
        c.wide ? "col-span-2 aspect-video" : "aspect-[9/16] md:aspect-[3/4]"
      }`}
    >
      <LoopVideo src={c.src} poster={c.poster} className="transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/70" />
      <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] text-white/90 shadow-[inset_0_0_0_.5px_rgb(255_255_255/.18)] backdrop-blur-md">
        {c.tag}
      </span>
      <div className="mk-pop pointer-events-none absolute inset-x-3 top-[58%] -translate-y-1/2 text-center">
        <Caption c={c} />
      </div>
      <figcaption className="absolute inset-x-3 bottom-3 text-[12px] text-white/80 sm:text-[13px]">{c.title}</figcaption>
    </figure>
  );
}

export function Showcase() {
  return (
    <section id="examples" className={`scroll-mt-12 ${SECTION_Y}`}>
      <div className={CONTAINER}>
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div>
            <Eyebrow>Made with Unfold</Eyebrow>
            <h2 className={`${H2} mt-4 max-w-2xl`}>
              Raw clips in. <Accent>Scroll-stoppers</Accent> out.
            </h2>
          </div>
          <Link href="/app" className="mk-ulink shrink-0 text-[15px]">
            Try it on your clip
            <IconArrowRight size={15} />
          </Link>
        </div>
        <div className="mt-14 grid grid-cols-2 gap-3 sm:gap-4 md:mt-20 md:grid-cols-3">
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
  const tilt = ["-rotate-6", "rotate-3", "-rotate-3", "rotate-6"];
  return (
    <div className="mk-hair inline-flex items-center rounded-full bg-[var(--mk-raised)]/60 py-1 pl-2 pr-3.5 backdrop-blur-sm" aria-hidden>
      {HERO_THUMBS.map((c, i) => (
        <div
          key={c.slug}
          className={`mk-frame mk-dark-frame relative -ml-1.5 h-9 w-[22px] overflow-hidden rounded-[6px] bg-[#0b0b0c] shadow-[0_4px_10px_-4px_rgb(0_0_0/.5)] first:ml-0 ${tilt[i % 4]}`}
        >
          <LoopVideo src={c.src} poster={c.poster} />
        </div>
      ))}
      <span className="mk-t2 ml-3 text-[12px]">
        Kimi K3.1 Pro on Cerebras <span className="mk-t4">·</span> OpenClaw
      </span>
    </div>
  );
}
