"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/Button";
import { IconSettings } from "@/components/ui/icons";
import { BrandLogo, BrandMark } from "@/components/ui/BrandLogo";

/** 56px frosted app header: wordmark left, optional centre, settings right. */
export function AppHeader({ children }: { children?: ReactNode }) {
  const path = usePathname();
  return (
    <header className="uf-app-header chrome">
      <div className="uf-app-header-inner">
        <Wordmark />
        <nav aria-label="Workspace" className="uf-workspace-nav">
          <Link href="/app" aria-current={path === "/app" ? "page" : undefined}>Edits</Link>
          <Link href="/app/publishing" aria-current={path.startsWith("/app/publishing") ? "page" : undefined}>Publishing</Link>
        </nav>
        {children && <div className="hidden min-w-0 flex-1 items-center justify-center sm:flex">{children}</div>}
        <Link href="/settings" aria-label="Settings" className={buttonClasses("ghost", "sm", "ml-auto")}>
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
