"use client";

/** Thin range slider with a label and a mono value readout. */
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="flex items-center gap-3 text-[12px] text-text-2">
      <span className="w-14 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ui-slider h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
        style={{ background: `linear-gradient(90deg, var(--text-1) ${pct}%, var(--surface-3) ${pct}%)` }}
      />
      <span className="tabular w-10 shrink-0 text-right font-mono text-[12px] text-text-2">{format ? format(value) : value}</span>
    </label>
  );
}
