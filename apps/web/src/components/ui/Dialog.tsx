"use client";

import { useEffect, useRef, type ReactNode } from "react";
import "./ui.css";

/** Modal dialog: 24px radius, page blurred 8px behind a 50% scrim. */
export function Dialog({ open, onClose, className = "", children }: { open: boolean; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`ui-dialog m-auto max-h-[calc(100dvh-32px)] overflow-y-auto rounded-[24px] bg-surface-1 p-0 text-text-1 shadow-[var(--shadow-float)] ${className}`}
    >
      {children}
    </dialog>
  );
}
