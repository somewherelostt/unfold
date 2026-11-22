"use client";

/** Segmented control: surface-2 track, sliding surface-3 thumb with a hairline, 28px. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
  mono = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  mono?: boolean;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" className={`relative grid h-7 rounded-[8px] bg-surface-2 p-0.5 ${className}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 rounded-[6px] bg-surface-3 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-transform duration-[var(--dur-pop)] ease-[var(--ease)]"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${i * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onKeyDown={(event) => {
            const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
            if (!direction && event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (i + direction + options.length) % options.length;
            onChange(options[next].value);
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
            buttons?.[next]?.focus();
          }}
          onClick={() => onChange(o.value)}
          className={`relative z-10 cursor-pointer truncate px-2 text-[12px] font-medium transition-colors ${mono ? "tabular font-mono" : ""} ${o.value === value ? "text-text-1" : "text-text-3 hover:text-text-2"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
