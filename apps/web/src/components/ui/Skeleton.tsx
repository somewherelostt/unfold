import "./ui.css";

/** Placeholder block that pulses (opacity .5 ↔ .8, 1.6s). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`ui-pulse bg-surface-2 ${className}`} />;
}
