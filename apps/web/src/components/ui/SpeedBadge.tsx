import { IconBolt } from "./icons";

/** "⚡ planned in 0.8s · 712 tok/s · Kimi K3.1 Pro on Cerebras" — mono, numbers in accent. */
export function SpeedBadge({
  seconds,
  tps,
  label = "planned in",
  model = true,
  className = "",
}: {
  seconds: number;
  tps: number;
  label?: string;
  model?: boolean;
  className?: string;
}) {
  return (
    <span className={`tabular inline-flex items-center gap-1.5 font-mono text-[12px] leading-4 text-text-2 ${className}`}>
      <IconBolt size={12} className="text-accent" />
      <span>
        {label} <span className="text-accent">{seconds.toFixed(1)}s</span>
      </span>
      <span className="text-text-4">·</span>
      <span>
        <span className="text-accent">{Math.round(tps).toLocaleString("en-US")}</span> tok/s
      </span>
      {model && (
        <>
          <span className="text-text-4">·</span>
          <span className="hidden sm:inline">Kimi K3.1 Pro on Cerebras</span>
        </>
      )}
    </span>
  );
}
