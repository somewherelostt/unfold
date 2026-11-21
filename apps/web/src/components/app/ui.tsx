"use client";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const fmtSec = (s: number) => `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
export const fmtNum = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};

export function Logo({ href = "/app", wordmark = true }: { href?: string; wordmark?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-ink" aria-label="Unfold home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.svg" alt="" width={28} height={25} />
      {wordmark && <span className="font-display text-[22px] font-extrabold tracking-[-0.03em]">unfold</span>}
    </Link>
  );
}

/** ⚡ planned in 0.8s · 1,100 tok/s */
export function SpeedBadge({ ms, tps, label = "planned in", className }: { ms: number; tps: number; label?: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-violet/10 px-2.5 py-1 font-mono text-[12px] font-medium text-violet tabular",
        className,
      )}
    >
      <span aria-hidden>⚡</span>
      {label ? `${label} ` : ""}
      {(ms / 1000).toFixed(1)}s · {fmtNum(tps)} tok/s
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" | "lg" };
export function Button({ variant = "secondary", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[background,color,opacity,transform] duration-[120ms] ease-out active:scale-[.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flare",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-[14px]",
        size === "lg" && "h-12 px-5 text-[15px]",
        variant === "primary" && "bg-flare text-flare-ink hover:brightness-105",
        variant === "secondary" && "border border-border bg-surface text-ink hover:bg-surface-2",
        variant === "ghost" && "text-ink-muted hover:bg-surface-2 hover:text-ink",
        className,
      )}
    />
  );
}

export function Chip({ selected, children, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...p}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-[13px] transition-colors duration-[120ms]",
        selected ? "bg-ink text-bg" : "bg-surface-2 text-ink hover:bg-border",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[120ms]", checked ? "bg-flare" : "bg-border")}
    >
      <span className={cx("absolute left-0 top-0.5 size-4 rounded-full bg-white shadow transition-transform duration-[120ms]", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-[11px] font-medium uppercase leading-4 tracking-[0.02em] text-ink-muted", className)}>{children}</div>;
}

const SFX_EMOJI: [RegExp, string][] = [
  [/boom|thud/, "💥"],
  [/whoosh|swoosh/, "💨"],
  [/scratch/, "💿"],
  [/ding|bell/, "🔔"],
  [/oof|bruh/, "😵"],
  [/trombone|trumpet|fail/, "🎺"],
  [/laugh/, "😂"],
  [/air-?horn/, "📯"],
  [/riser/, "📈"],
  [/camera|shutter/, "📸"],
  [/pop/, "🫧"],
  [/glitch/, "📺"],
  [/cash/, "💰"],
  [/wow|woah/, "😮"],
  [/applause/, "👏"],
  [/boing/, "🌀"],
  [/buzzer|error/, "❌"],
];
export const sfxEmoji = (id: string) => SFX_EMOJI.find(([re]) => re.test(id))?.[1] ?? "🔊";

export const STYLE_META = {
  "gaming-montage": { label: "Gaming Montage", swatch: ["#FF5A1F", "#111114", "#FFE14D"], blurb: "Hard cuts, glitch, bold captions" },
  "podcast-clip": { label: "Podcast Clip", swatch: ["#F5F5F2", "#2F80ED", "#0B0B0C"], blurb: "Clean captions, trimmed air" },
  storytime: { label: "Storytime", swatch: ["#7B5CFF", "#FFE14D", "#FAFAF7"], blurb: "Story order, slow push-ins" },
  chaos: { label: "Chaos", swatch: ["#FF4FA3", "#FFE14D", "#7B5CFF"], blurb: "Meme hits, shake, every beat" },
  custom: { label: "Custom", swatch: ["#6A6A70", "#E6E4DE", "#0B0B0C"], blurb: "Your description" },
} as const;

/** Simple 20px stroke icons. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {ICONS[name]}
    </svg>
  );
}
type IconName = keyof typeof ICONS;
const ICONS = {
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10 10.5a2 2 0 1 0 0 3M16.5 10.5a2 2 0 1 0 0 3" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V6l11-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  sfx: (
    <>
      <path d="M4 10v4h3l5 4V6L7 10z" />
      <path d="M16 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  transitions: (
    <>
      <rect x="3" y="6" width="8" height="12" rx="2" />
      <rect x="13" y="6" width="8" height="12" rx="2" />
      <path d="M11 12h2" />
    </>
  ),
  style: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.5" cy="10" r="1.2" fill="currentColor" />
      <circle cx="12" cy="7.5" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="10" r="1.2" fill="currentColor" />
      <path d="M12 21a3 3 0 0 1 0-6h2" />
    </>
  ),
  export: (
    <>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  zoom: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5M11 8v6M8 11h6" />
    </>
  ),
  wand: <path d="M4 20L15 9M14 4v2M19 9h2M17.5 5.5L19 4M9 4l.5 1.5M19 14l-1.5-.5" />,
  send: <path d="M5 12h14M13 6l6 6-6 6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
} as const;
