"use client";

import type { ReactNode } from "react";
import "./ui.css";

/** Bottom-centre pill toast with optional inline actions ("Open", "Download"). */
export function Toast({ icon, children, actions, onClose }: { icon?: ReactNode; children: ReactNode; actions?: ReactNode; onClose?: () => void }) {
  return (
    <div role="status" className="ui-pop fixed bottom-5 left-1/2 z-[60] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-full bg-surface-2 py-1.5 pl-4 pr-1.5 text-[13px] text-text-1 shadow-[var(--shadow-float)]">
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {actions && <span className="flex shrink-0 items-center gap-1">{actions}</span>}
      {onClose && (
        <button type="button" aria-label="Dismiss" onClick={onClose} className="grid size-7 cursor-pointer place-items-center rounded-full text-text-3 hover:text-text-1">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
