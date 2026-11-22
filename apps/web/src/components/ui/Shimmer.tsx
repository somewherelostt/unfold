import type { ReactNode } from "react";
import "./ui.css";

/** Agent-working text: a calm violet shimmer over the words. Static (text-2) when `active` is false. */
export function Shimmer({ children, active = true, className = "" }: { children: ReactNode; active?: boolean; className?: string }) {
  return <span className={`${active ? "ui-shimmer" : "text-text-2"} ${className}`}>{children}</span>;
}
