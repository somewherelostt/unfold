"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/Button";
import { IconSettings } from "@/components/ui/icons";

/** 56px frosted app header: wordmark left, optional centre, settings right. */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="frosted chrome sticky top-0 z-30 shadow-[inset_0_-1px_0_var(--hairline)]">
      <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-3 px-4 sm:px-8">
        <Wordmark />
        <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>
        <Link href="/settings" className={buttonClasses("ghost", "sm")}>
          <IconSettings />
          <span className="hidden sm:inline">Settings</span>
        </Link>
      </div>
    </header>
  );
}

export function Wordmark({ href = "/app", size = "md" }: { href?: string; size?: "sm" | "md" }) {
  return (
    <Link href={href} className="chrome flex items-center gap-2 text-text-1" aria-label="Unfold home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.svg" alt="" width={size === "sm" ? 20 : 24} height={size === "sm" ? 18 : 21} />
      {size === "md" && <span className="font-wordmark text-[19px] font-extrabold tracking-[-0.03em]">unfold</span>}
    </Link>
  );
}
