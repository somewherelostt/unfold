"use client";

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import "./ui.css";

/**
 * Click-to-open popover anchored to its trigger. Closes on outside click and Escape.
 * Surface-1, raised shadow, 8px padding; opens with fade + scale .96 (180ms).
 */
export function Popover({
  trigger,
  children,
  align = "end",
  side = "bottom",
  className = "",
  open: controlled,
  onOpenChange,
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  className?: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const set = (o: boolean) => (onOpenChange ? onOpenChange(o) : setInner(o));
  const root = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const contentId = useId();
  const close = () => set(false);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !root.current?.contains(e.target as Node) && set(false);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { set(false); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <div ref={root} className="relative">
      {(() => {
        const control = trigger({ open, toggle: () => set(!open) });
        return isValidElement(control) ? cloneElement(control as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>, { id: triggerId, "aria-expanded": open, "aria-controls": open ? contentId : undefined, "aria-haspopup": "dialog" }) : control;
      })()}
      {open && (
        <div
          role="dialog"
          id={contentId}
          aria-labelledby={triggerId}
          className={`ui-pop absolute z-50 rounded-[14px] bg-surface-1 p-2 shadow-[var(--shadow-raised)] ${
            align === "end" ? "right-0 origin-top-right" : align === "start" ? "left-0 origin-top-left" : "left-1/2 -translate-x-1/2 origin-top"
          } ${side === "bottom" ? "top-full mt-2" : "bottom-full mb-2"} ${className}`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** Menu row: 30px, 13px, optional mono shortcut hint right-aligned. */
export function MenuItem({ hint, selected, className = "", children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { hint?: ReactNode; selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...p}
      className={`flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 text-left text-[13px] transition-colors hover:bg-surface-3 disabled:opacity-40 ${selected ? "text-text-1" : "text-text-2 hover:text-text-1"} ${className}`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="tabular font-mono text-[11px] text-text-3">{hint}</span>}
    </button>
  );
}
