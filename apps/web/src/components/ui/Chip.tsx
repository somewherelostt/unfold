import type { ButtonHTMLAttributes } from "react";

/** Preset chip: 32px, 10px radius, surface-3. Selected = hairline-strong ring. */
export function Chip({ selected, className = "", type = "button", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      {...p}
      className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-medium text-text-1 transition-[background-color,box-shadow] duration-150 ${
        selected
          ? "bg-surface-3 shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
          : "bg-surface-3/70 shadow-[inset_0_0_0_1px_var(--hairline)] hover:bg-surface-3"
      } ${className}`}
    />
  );
}
