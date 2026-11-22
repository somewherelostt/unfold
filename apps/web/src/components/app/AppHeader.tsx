"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/Button";
import { IconSettings } from "@/components/ui/icons";
import { BrandLogo, BrandMark } from "@/components/ui/BrandLogo";

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
      {size === "sm" ? <BrandMark width={24} height={24} /> : <BrandLogo width={112} height={27} />}
    </Link>
  );
}
