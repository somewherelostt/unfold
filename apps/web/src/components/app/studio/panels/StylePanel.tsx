"use client";
import { Button } from "@/components/ui/Button";
import { SectionLabel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { IconGrid } from "@/components/ui/icons";
import { Row } from "./CaptionsPanel";
import type { PanelProps } from "./types";

const STYLE_NAME: Record<string, string> = {
  "gaming-montage": "Gaming montage",
  "podcast-clip": "Podcast clip",
  storytime: "Storytime",
  chaos: "Chaos",
  custom: "Custom",
};

export function StylePanel({ plan, base, overrides, set, onAlternates }: PanelProps) {
  return (
    <div className="space-y-5 px-4 pb-4">
      <div className="rounded-[12px] bg-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--hairline)]">
        <div className="text-[13px] font-medium text-text-1">{STYLE_NAME[plan.style] ?? plan.style}</div>
        <p className="mt-1 text-[12px] leading-[18px] text-text-2">{plan.rationale}</p>
      </div>
      <Row label="Format">
        <Segmented label="Output format"
          mono
          className="w-[168px]"
          options={(["9:16", "1:1", "16:9"] as const).map((v) => ({ value: v, label: v }))}
          value={plan.aspect}
          onChange={(v) => set({ aspect: v })}
        />
      </Row>
      <div>
        <SectionLabel className="mb-2">Hook text</SectionLabel>
        <input
            aria-label="Hook text"
          value={overrides.hookText !== undefined ? (overrides.hookText ?? "") : (base.hookText ?? "")}
          onChange={(e) => set({ hookText: e.target.value || null })}
          placeholder="No hook text"
          className="h-9 w-full rounded-[10px] bg-surface-2 px-3 text-[13px] text-text-1 shadow-[inset_0_0_0_1px_var(--hairline)] outline-none placeholder:text-text-3"
        />
        <p className="mt-1.5 text-[11px] text-text-3">Shown big in the first two seconds.</p>
      </div>
      <div>
        <SectionLabel className="mb-2">Not sure about the hook?</SectionLabel>
        <Button variant="secondary" className="w-full" onClick={onAlternates}>
          <IconGrid size={14} /> Try 3 alternate versions
        </Button>
      </div>
    </div>
  );
}
