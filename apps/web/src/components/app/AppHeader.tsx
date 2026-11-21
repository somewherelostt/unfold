"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, Logo } from "./ui";

/** 48px glass nav for home + variants. */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="glass hair-b chrome sticky top-0 z-20">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Logo />
        <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>
        <Link href="/settings" className="tint fg-2 flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 hover:text-[var(--fg-1)]">
          <Icon name="settings" />
          <span className="hidden sm:inline">Settings</span>
        </Link>
      </div>
    </header>
  );
}

export function HeaderLink({ href, onClick, icon, children }: { href?: string; onClick?: () => void; icon: Parameters<typeof Icon>[0]["name"]; children: ReactNode }) {
  const cls = "tint fg-2 flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 hover:text-[var(--fg-1)]";
  return href ? (
    <Link href={href} className={cls}>
      <Icon name={icon} /> {children}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      <Icon name={icon} /> {children}
    </button>
  );
}
