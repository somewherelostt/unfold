"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Accent, CONTAINER, Eyebrow, H2, SECTION_Y } from "./ui";

// One full variants run ≈ 9 edit plans × ~590 tokens ≈ 5,300 output tokens.
const TOKENS = 5300;
const ROWS = [
  { label: "Kimi K3.1 Pro on Cerebras", tps: 700, highlight: true },
  { label: "Typical GPU inference", tps: 80, highlight: false },
];

const seconds = (tps: number) => TOKENS / tps;

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
    <section id="speed" className={`mk-band scroll-mt-12 ${SECTION_Y}`}>
      <div ref={ref} className={`${CONTAINER} grid gap-16 lg:grid-cols-[1fr_1.1fr] lg:gap-24`}>
        <div>
          <Eyebrow>Speed</Eyebrow>
          <h2 className={`${H2} mt-4`}>
            Nine edits before you finish <Accent>reading this.</Accent>
          </h2>
          <p className="mk-t2 mt-6 max-w-md text-[15px] leading-6 text-balance sm:text-[17px] sm:leading-7">
            Every variant is a full edit plan: cuts, captions, music, sound effects. The agent writes all nine at around 700
            tokens a second, so remixing feels like a conversation, not a render queue.
          </p>
          <dl className="mt-12 grid grid-cols-3 gap-6">
            {[
              ["~700", "tok/s"],
              ["7.6s", "9 edit plans"],
              ["0.8s", "per remix"],
            ].map(([n, l]) => (
              <div key={l}>
                <dt className="tabular text-[34px] font-light leading-none tracking-[-0.03em] text-ink sm:text-[44px]">{n}</dt>
                <dd className="mk-t3 mt-2 font-mono text-[11px]">{l}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex flex-col justify-center">
          <div className="mk-hair rounded-2xl bg-[var(--mk-raised)] p-6 sm:p-8">
            <div className="mk-t3 flex items-center justify-between text-[13px]">
              <span>Time to plan 9 variants</span>
              <span className="font-mono text-[11px]">~{TOKENS.toLocaleString("en-US")} tokens</span>
            </div>
            <div className="mt-8 space-y-8">
              {ROWS.map((r, i) => {
                const s = seconds(r.tps);
                return (
                  <div key={r.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={`text-[15px] ${r.highlight ? "text-ink" : "mk-t2"}`}>{r.label}</span>
                      <span className={`tabular font-mono text-[14px] ${r.highlight ? "text-flare" : "mk-t3"}`}>{s.toFixed(1)}s</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--mk-line)]">
                      <div
                        className={`mk-bar h-full rounded-full ${r.highlight ? "bg-flare" : "bg-[var(--mk-t4)]"}`}
                        data-on={on}
                        style={{ width: `${Math.max(3, (s / max) * 100)}%`, "--dur": i === 0 ? "500ms" : "2600ms" } as CSSProperties}
                      />
                    </div>
                    <div className="mk-t4 mt-2 font-mono text-[11px]">{r.tps.toLocaleString("en-US")} tok/s</div>
                  </div>
                );
              })}
            </div>
            <p className="mk-hair-top mk-t2 mt-8 pt-5 text-[13px]">
              Built on <span className="text-ink">Kimi K3.1 Pro</span> on <span className="text-ink">Cerebras</span>{" "}
              <span className="mk-t4">·</span> <span className="text-ink">OpenClaw</span>
            </p>
          </div>
          <p className="mk-t4 mt-4 text-[11px] leading-4">
            The GPU figure is an illustrative estimate at a typical hosted-inference rate. Times vary with clip length and load.
          </p>
        </div>
      </div>
    </section>
  );
}
