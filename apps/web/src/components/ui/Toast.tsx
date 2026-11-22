"use client";

import type { ReactNode } from "react";
import "./ui.css";

/** Bottom-centre pill toast with optional inline actions ("Open", "Download"). */
export function Toast({ icon, children, actions, onClose, role = "status" }: { icon?: ReactNode; children: ReactNode; actions?: ReactNode; onClose?: () => void; role?: "status" | "alert" }) {
  return (
    <div role={role} style={{ translate: "-50% 0" }} className="ui-pop fixed bottom-5 left-1/2 z-[60] grid w-[calc(100vw-32px)] max-w-[640px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 rounded-2xl bg-surface-2 p-3 text-[13px] text-text-1 shadow-[var(--shadow-float)] sm:flex sm:w-max">
      {icon && <span className="col-start-1 row-start-1 shrink-0 self-start pt-1">{icon}</span>}
      <span className={`${icon ? "col-start-2" : "col-start-1"} col-end-3 row-start-1 min-w-0 break-words`}>{children}</span>
      {actions && <span className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-1 sm:shrink-0">{actions}</span>}
      {onClose && (
        <button type="button" aria-label="Dismiss" onClick={onClose} className="col-start-3 row-start-1 grid size-7 shrink-0 cursor-pointer place-items-center self-start rounded-full text-text-3 hover:text-text-1">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
