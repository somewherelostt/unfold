"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, Logo } from "./ui";

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Logo />
        <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>
        <Link href="/settings" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-ink-muted hover:bg-surface-2 hover:text-ink">
          <Icon name="settings" className="size-4" />
          <span className="hidden sm:inline">Settings</span>
        </Link>
      </div>
    </header>
  );
}
