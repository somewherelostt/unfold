/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from "react";

/* ---------- shared bits ---------- */

export const CONTAINER = "mx-auto w-full max-w-6xl px-5 sm:px-8";
export const SECTION_Y = "py-24 md:py-40";
export const H2 = "font-light text-[36px] leading-[1.05] tracking-[-0.035em] text-balance text-ink sm:text-5xl md:text-[60px]";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <img src="/logo-mark.svg" alt="" width={28} height={25} className="-ml-1 h-[25px] w-[28px]" />
      <span className="font-display text-[19px] font-extrabold leading-none tracking-[-0.03em] text-ink">unfold</span>
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mk-t3 font-mono text-[11px] uppercase tracking-[.1em]">{children}</p>;
}

export function Accent({ children }: { children: ReactNode }) {
  return <span className="font-display font-extrabold italic tracking-[-0.03em] text-flare">{children}</span>;
}

