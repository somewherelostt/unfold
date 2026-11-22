"use client";
import type { TransitionType } from "@unfold/core";
import { transitionPoints } from "@/lib/client/store";
import { SectionLabel } from "@/components/ui/Panel";
import { Popover, MenuItem } from "@/components/ui/Popover";
import { Toggle } from "@/components/ui/Toggle";
import { IconChevronDown } from "@/components/ui/icons";
import { cx } from "../../ui";
import { Row } from "./CaptionsPanel";
import type { PanelProps } from "./types";

const TYPES: { id: TransitionType; label: string }[] = [
  { id: "cut", label: "Straight cut" },
  { id: "whip", label: "Whip pan" },
  { id: "zoom-punch", label: "Zoom punch" },
  { id: "flash", label: "Flash" },
  { id: "shake", label: "Shake" },
  { id: "glitch", label: "Glitch" },
  { id: "slide", label: "Slide" },
];
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

export function TransitionsPanel({ plan, base, overrides, frames, set, seek }: PanelProps) {
  const a = frames[1]?.url ?? frames[0]?.url;
  const b = frames[Math.min(frames.length - 1, 3)]?.url ?? a;
  const types = overrides.transitionTypes ?? {};
  const points = transitionPoints(base);
  const applyAll = (t: TransitionType) => set({ transitions: true, transitionTypes: Object.fromEntries(points.map((_, i) => [i, t])) });
  const usedTypes = new Set<TransitionType>(plan.transitions.length ? plan.transitions.map((t) => t.type) : ["cut"]);

  return (
    <div className="uf-tool-content space-y-5 px-4 pb-4">
      <div className="space-y-3">
        <Row label="Transitions">
          <Toggle label="Transitions" checked={plan.transitions.length > 0} onChange={(v) => set({ transitions: v })} />
        </Row>
        <Row label="Zoom punches">
          <Toggle label="Zoom punches" checked={plan.zooms.length > 0} onChange={(v) => set({ zooms: v })} />
        </Row>
      </div>

      <div>
        <SectionLabel className="mb-2">Apply to every cut</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map((t) => (
            <button key={t.id} type="button" aria-pressed={usedTypes.has(t.id)} disabled={!points.length} onClick={() => applyAll(t.id)} className="group text-left disabled:opacity-35">
              <span
                className={cx(
                  `uf-tx-${t.id} relative block aspect-video overflow-hidden rounded-[10px] bg-black transition-shadow`,
                  usedTypes.has(t.id) ? "shadow-[0_0_0_2px_var(--accent)]" : "shadow-[inset_0_0_0_1px_var(--hairline)] group-hover:shadow-[inset_0_0_0_1px_var(--hairline-strong)]",
                )}
              >
                <span className="uf-tx" style={{ backgroundImage: `url(${a})` }} />
                <span className="uf-tx uf-tx-b" style={{ backgroundImage: `url(${b})` }} />
                <span className="uf-tx uf-tx-w bg-white opacity-0" />
              </span>
              <span className="mt-1 block text-[12px] text-text-2 group-hover:text-text-1">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      {!points.length && <p className="text-[12px] text-text-3">This edit has one continuous shot. Ask the agent for more cuts to add transitions.</p>}

      {points.length > 0 && (
        <div>
          <SectionLabel className="mb-2">Per cut</SectionLabel>
          <div className="space-y-0.5">
            {points.map((t, i) => {
              const type = overrides.transitions === false ? "cut" : types[i] ?? plan.transitions.find((x) => Math.abs(x.at - t.at) < 0.05)?.type ?? "cut";
              return (
                <div key={i} className="flex h-8 items-center gap-2 rounded-[8px] px-2 hover:bg-surface-2">
                  <span className="size-2 rotate-45 rounded-[2px] bg-track-transition-ink" />
                  <button type="button" onClick={() => seek(t.at)} className="text-[13px] text-text-1">
                    Cut {i + 1}
                  </button>
                  <span className="tabular font-mono text-[12px] text-text-2">{clock(t.at)}</span>
                  <div className="ml-auto">
                    <Popover
                      align="end"
                      className="w-40"
                      trigger={({ toggle }) => (
                        <button type="button" onClick={toggle} className="flex h-6 items-center gap-1 rounded-full px-2 text-[12px] text-text-2 hover:bg-surface-3 hover:text-text-1">
                          {TYPES.find((x) => x.id === type)?.label ?? type}
                          <IconChevronDown size={12} />
                        </button>
                      )}
                    >
                      {(close) =>
                        TYPES.map((x) => (
                          <MenuItem
                            key={x.id}
                            selected={x.id === type}
                            onClick={() => {
                              set({ transitions: true, transitionTypes: { ...types, [i]: x.id } });
                              close();
                            }}
                          >
                            {x.label}
                          </MenuItem>
                        ))
                      }
                    </Popover>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
