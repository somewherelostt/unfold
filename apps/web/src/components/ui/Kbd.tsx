import type { ReactNode } from "react";

/** Keyboard hint, mono 11px. `tone="dark"` for use on the white primary button. */
export function Kbd({ children, tone = "light", className = "" }: { children: ReactNode; tone?: "light" | "dark"; className?: string }) {
  return (
    <kbd className={`tabular inline-flex h-[18px] items-center rounded-[5px] px-1 font-mono text-[11px] ${tone === "dark" ? "bg-black/10 text-current opacity-70" : "bg-surface-3 text-text-3"} ${className}`}>
      {children}
    </kbd>
  );
}
