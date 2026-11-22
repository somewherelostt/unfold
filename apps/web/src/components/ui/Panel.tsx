import type { HTMLAttributes, ReactNode } from "react";

/** Floating panel card: surface-1, 18px radius, raised shadow. Used for editor side panels, drawers, chat. */
export function Panel({ className = "", ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={`ui-panel rounded-[18px] bg-surface-1 shadow-[var(--shadow-raised)] ${className}`} />;
}

/** Panel header row: title (13/500) left, actions right, 44px tall. */
export function PanelHeader({ title, meta, actions, className = "" }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`ui-panel-header flex h-11 shrink-0 items-center gap-2 px-4 ${className}`}>
      <span className="text-[13px] font-medium text-text-1">{title}</span>
      {meta && <span className="truncate text-[12px] text-text-3">{meta}</span>}
      {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
    </div>
  );
}

/** Section label: meta caps 11/14, +0.06em, text-3. */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[11px] font-medium uppercase leading-[14px] tracking-[0.06em] text-text-3 ${className}`}>{children}</div>;
}
