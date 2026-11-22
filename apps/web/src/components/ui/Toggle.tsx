"use client";

/** Switch, 28×16. On = text-1 fill (neutral; colour is reserved for signals). */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="ui-toggle relative flex h-8 w-10 shrink-0 cursor-pointer items-center justify-end rounded-lg"
    >
      <span aria-hidden className={`relative block h-4 w-7 rounded-full transition-colors duration-150 ${checked ? "bg-text-1" : "bg-surface-3 shadow-[inset_0_0_0_1px_var(--hairline-strong)]"}`}>
      <span
        className={`absolute left-0 top-0.5 size-3 rounded-full transition-transform duration-[var(--dur-pop)] ease-[var(--ease)] ${checked ? "translate-x-[14px] bg-bg" : "translate-x-0.5 bg-text-2"}`}
      />
      </span>
    </button>
  );
}
