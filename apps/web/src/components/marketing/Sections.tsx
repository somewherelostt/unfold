"use client";

import Link from "next/link";
import { useEffect, useRef, type CSSProperties } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/icons";
import { PromptShell } from "@/components/ui/PromptShell";
import { Wordmark } from "./Hero";
import { useInView, useReducedMotion } from "./hooks";
import { PreviewCard } from "./Preview";
import { CLIPS } from "./showcase-clips";

/* ---------- FAQ ---------- */

const FAQS: [string, string][] = [
  ["What kind of clips work?", "Gameplay, vlogs, interviews and more. Upload vertical or horizontal footage up to three minutes. Export an MP4 in 9:16, 1:1 or 16:9."],
  ["How does an inspiration video help?", "Add a link or file. Unfold uses its pacing and visible caption treatment as a reference, then adapts the edit to your footage and brief."],
  ["Where does the music come from?", "When music suits your clip, Unfold can choose a track from its library and align cuts to the beat. A natural edit can keep the original audio without added music."],
  ["Can I change what the agent did?", "Yes. Ask in chat for faster cuts, fewer sounds or bigger captions. Unfold reworks the plan, and you can keep shaping it in the editor."],
  ["What happens after I upload?", "Unfold analyses your footage and plans one edit around your brief. Preview it, review any generated captions, ask for changes and export an MP4 when ready."],
  ["Is this a template?", "No. Unfold plans one edit around your footage and brief, choosing the pacing and whether captions, music or effects help."],
];

export function Faq() {
  return (
    <section id="faq" className="mk-section scroll-mt-24 bg-[var(--card)]">
      <div className="mk-container grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:gap-16">
        <div>
          <p className="mk-label">FAQ</p>
          <h2 className="mk-title mt-3">
            Frequently asked <em>questions</em>
          </h2>
        </div>
        <div>
          {FAQS.map(([q, a], i) => (
            <details key={q} className="mk-faq group shadow-[inset_0_-1px_0_var(--hairline)]" open={i === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-medium tracking-[-0.01em] text-text-1">
                {q}
                <span className="mk-faq-icon shrink-0 text-text-3 transition-transform duration-200 ease-[var(--ease)]">
                  <IconPlus size={16} />
                </span>
              </summary>
              <p className="-mt-1 max-w-[600px] pb-5 pr-8 text-[15px] leading-6 text-text-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- final CTA: clips enter from the edges, follow the mouse by depth ---------- */

const EDGE = [
  { clip: CLIPS.coast, cls: "left-[3%] top-[8%]", w: 140, r: -8, from: [-1, 0], depth: 24 },
  { clip: CLIPS.parkour, cls: "left-[11%] bottom-[6%]", w: 120, r: 6, from: [-1, 0], depth: 14 },
  { clip: CLIPS.creator, cls: "right-[4%] top-[6%]", w: 136, r: 8, from: [1, 0], depth: 28 },
  { clip: CLIPS.skate, cls: "right-[12%] bottom-[8%]", w: 118, r: -6, from: [1, 0], depth: 12 },
];

export function FinalCta() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { amount: 0.3 });
  const layer = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const host = ref.current;
    const el = layer.current;
    if (!host || !el) return;
    if (reduce) {
      el.style.removeProperty("--mx");
      el.style.removeProperty("--my");
      return;
    }
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
    const move = (e: PointerEvent) => {
      if (window.innerWidth < 1024 || e.pointerType !== "mouse") return;
      const r = host.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5;
      ty = (e.clientY - r.top) / r.height - 0.5;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const reset = () => {
      tx = 0;
      ty = 0;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const loop = () => {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      el.style.setProperty("--mx", x.toFixed(3));
      el.style.setProperty("--my", y.toFixed(3));
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.001 ? requestAnimationFrame(loop) : 0;
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", reset);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", reset);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  return (
    <section ref={ref} className="relative overflow-hidden py-28 lg:py-44">
      <div className="mk-glow pointer-events-none absolute inset-0 -z-10" />
      <div ref={layer} aria-hidden className="pointer-events-none absolute inset-0 mx-auto hidden max-w-[1440px] lg:block">
        {EDGE.map((e, i) => (
          <div
            key={e.clip.slug}
            className={`absolute ${e.cls}`}
            style={{
              width: e.w,
              opacity: seen ? 1 : 0,
              transform: seen
                ? `translate3d(calc(var(--mx, 0) * ${e.depth}px), calc(var(--my, 0) * ${e.depth}px), 0) rotate(${e.r}deg)`
                : `translate3d(${e.from[0] * 160}px, ${e.from[1] * 160}px, 0) rotate(${e.r * 0.4}deg) scale(.9)`,
              transition: `opacity 900ms var(--ease) ${i * 90}ms, transform 900ms var(--ease) ${i * 90}ms`,
            }}
          >
            <PreviewCard src={e.clip.src} poster={e.clip.poster} className="shadow-[var(--shadow-float)]" />
          </div>
        ))}
      </div>
      <div className="mk-container relative flex flex-col items-center text-center">
        <h2 className="mk-hero-title max-w-[720px]">
          Make something worth <em>watching.</em>
        </h2>
        <PromptShell className="mk-prompt-shell mt-8 max-w-[640px]" showPresets={false} />
        <ButtonLink href="/app" variant="primary" size="lg" className="mt-6">
          Start editing
        </ButtonLink>
      </div>
    </section>
  );
}

/* ---------- footer: ruler ticks + giant cropped wordmark ---------- */

export function Footer() {
  return (
    <footer className="mk-footer relative overflow-hidden pt-16">
      <div className="mk-ruler mb-14 w-full" aria-hidden />
      <div className="mk-container grid grid-cols-2 gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1">
          <Wordmark />
          <p className="mt-4 max-w-[320px] text-[22px] font-medium leading-7 tracking-[-0.02em] text-text-1">Raw footage in. Your story, edited.</p>
          <p className="mt-3 text-[12px] text-text-3">Powered by Kimi K3.1 Pro on Cerebras · OpenClaw</p>
        </div>
        <FooterCol title="Product" links={[["Styles", "#styles"], ["How it works", "#ways"], ["Workflow", "#speed"], ["FAQ", "#faq"]]} />
        <FooterCol title="Start" links={[["Start editing", "/app"], ["Sign in", "/login"]]} />
      </div>
      <div aria-hidden className="mk-wordmark-giant pointer-events-none mt-6 select-none text-center" style={{ marginBottom: "-0.22em" } as CSSProperties}>
        unfold
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="mk-label">{title}</p>
      <ul className="mt-4 space-y-2.5 text-[14px]">
        {links.map(([l, h]) => (
          <li key={l}>
            <Link href={h} className="text-text-2 transition-colors hover:text-text-1">
              {l}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
