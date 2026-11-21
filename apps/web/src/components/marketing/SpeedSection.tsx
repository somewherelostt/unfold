"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { IconBolt } from "./icons";

// One full variants run ≈ 9 edit plans × ~590 tokens ≈ 5,300 output tokens.
const TOKENS = 5300;
const ROWS = [
  { label: "Kimi K3.1 Pro on Cerebras", tps: 700, highlight: true },
  { label: "Typical GPU inference", tps: 80, highlight: false },
];

function seconds(tps: number) {
  return TOKENS / tps;
}

export function SpeedSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const max = seconds(ROWS[1].tps);

  return (
    <section id="speed" className="scroll-mt-20 px-4 py-14 sm:px-6 md:py-24">
      <div ref={ref} className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-border bg-surface">
        <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16 lg:p-14">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[.08em] text-flare">Speed</p>
            <h2 className="mt-3 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink sm:text-[48px]">
              Nine edits before you finish reading this.
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-6 text-ink-muted">
              Every variant is a full edit plan: cuts, captions, music, sound effects. The agent writes all nine at
              around 700 tokens a second, so remixing feels like a conversation, not a render queue.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-3">
              {[
                ["~700", "tok/s"],
                ["7.6s", "9 edit plans"],
                ["0.8s", "per remix"],
              ].map(([n, l]) => (
                <div key={l} className="rounded-xl bg-surface-2 px-3 py-3">
                  <div className="tabular font-display text-[24px] font-extrabold tracking-tight text-ink sm:text-[28px]">{n}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <div className="rounded-2xl border border-border bg-bg p-5 sm:p-6">
              <div className="flex items-center justify-between text-[13px] text-ink-muted">
                <span>Time to plan 9 variants</span>
                <span className="font-mono text-[11px]">~{TOKENS.toLocaleString("en-US")} tokens</span>
              </div>
              <div className="mt-6 space-y-6">
                {ROWS.map((r, i) => {
                  const s = seconds(r.tps);
                  return (
                    <div key={r.label}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={`text-[14px] font-medium ${r.highlight ? "text-ink" : "text-ink-muted"}`}>{r.label}</span>
                        <span className={`tabular font-mono text-[14px] font-medium ${r.highlight ? "text-flare" : "text-ink-muted"}`}>
                          {s.toFixed(1)}s
                        </span>
                      </div>
                      <div className="mt-2 h-3 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className={`mk-bar h-full rounded-full ${r.highlight ? "bg-flare" : "bg-ink-muted/50"}`}
                          data-on={on}
                          style={{ width: `${Math.max(3, (s / max) * 100)}%`, "--dur": i === 0 ? "500ms" : "2600ms" } as CSSProperties}
                        />
                      </div>
                      <div className="mt-1.5 font-mono text-[11px] text-ink-muted">{r.tps.toLocaleString("en-US")} tok/s</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-6 flex items-center gap-2 border-t border-border pt-4 text-[13px] text-ink">
                <IconBolt size={14} className="text-flare" />
                <span>
                  Built on <strong className="font-semibold">Kimi K3.1 Pro</strong> on{" "}
                  <strong className="font-semibold">Cerebras</strong> · <strong className="font-semibold">OpenClaw</strong>
                </span>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-4 text-ink-muted">
              GPU figure is an illustrative estimate at a typical hosted-inference rate. Your times vary with clip length and load.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
