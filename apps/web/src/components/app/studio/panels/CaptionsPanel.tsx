"use client";
import type { CaptionPreset } from "@unfold/core";
import { SectionLabel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Toggle } from "@/components/ui/Toggle";
import { captionFamily, useCaptionFonts } from "../../fonts";
import { cx } from "../../ui";
import type { PanelProps } from "./types";

const PRESETS: { id: CaptionPreset; label: string; upper: boolean; box?: boolean }[] = [
  { id: "bold-pop", label: "Bold pop", upper: true },
  { id: "meme", label: "Meme", upper: true },
  { id: "karaoke", label: "Karaoke", upper: true, box: true },
  { id: "clean-pop", label: "Clean", upper: false },
  { id: "story", label: "Story", upper: false },
];
const SWATCHES = ["#FFE14D", "#FF5A1F", "#3CDDA7", "#8F75FF", "#FFFFFF"];

export function CaptionsPanel({ plan, overrides, set }: PanelProps) {
  useCaptionFonts();
  const c = plan.captions;
  const line = (c.chunks.find((x) => x.words.length >= 2) ?? c.chunks[0])?.words.slice(0, 3) ?? [{ text: "this", emphasis: false }, { text: "is", emphasis: false }, { text: "insane", emphasis: true }];
  const lit = Math.max(0, line.findIndex((w) => w.emphasis));
  const wpl = overrides.wordsPerLine ?? Math.max(1, Math.min(4, Math.round(c.chunks.reduce((a, x) => a + x.words.length, 0) / Math.max(1, c.chunks.length))));
  return (
    <div className="space-y-5 px-4 pb-4">
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-label={`${p.label} captions`}
            aria-pressed={c.preset === p.id}
            onClick={() => set({ captionPreset: p.id, captions: true, uppercase: p.upper })}
            className={cx(
              "group relative flex h-[84px] flex-col items-center justify-center overflow-hidden rounded-[12px] bg-[#0d0d10] transition-shadow",
              c.preset === p.id ? "shadow-[0_0_0_2px_var(--accent)]" : "shadow-[inset_0_0_0_1px_var(--hairline)] hover:shadow-[inset_0_0_0_1px_var(--hairline-strong)]",
            )}
          >
            <span className="px-2 text-center text-[17px] leading-tight" style={{ fontFamily: captionFamily(p.id), fontWeight: 900, textTransform: p.upper ? "uppercase" : "none", color: "#fff", WebkitTextStroke: "3px #000", paintOrder: "stroke fill" }}>
              {line.map((w, i) => (
                <span key={i} style={i === lit ? (p.box ? { background: c.highlightColor, color: "#111", WebkitTextStroke: "0", padding: "0 4px", borderRadius: 4 } : { color: c.highlightColor }) : undefined}>
                  {w.text}
                  {i < line.length - 1 ? " " : ""}
                </span>
              ))}
            </span>
            <span className="absolute bottom-1.5 left-2 text-[10px] text-white/55">{p.label}</span>
          </button>
        ))}
      </div>
      {!c.chunks.length && <p className="text-[12px] text-text-3">No speech was found in this clip. Your hook text can still appear at the start.</p>}

      <div className="space-y-3">
        <Row label="Captions">
          <Toggle label="Captions" checked={c.enabled} onChange={(v) => set({ captions: v })} />
        </Row>
        <Row label="Words per line">
          <Segmented mono className="w-[148px]" options={["1", "2", "3", "4"].map((v) => ({ value: v, label: v }))} value={String(wpl)} onChange={(v) => set({ wordsPerLine: Number(v) })} />
        </Row>
        <Row label="Position">
          <Segmented
            className="w-[184px]"
            options={[
              { value: "upper", label: "Top" },
              { value: "center", label: "Middle" },
              { value: "lower", label: "Bottom" },
            ]}
            value={c.position}
            onChange={(v) => set({ captionPosition: v })}
          />
        </Row>
        <Row label="Uppercase">
          <Toggle label="Uppercase" checked={c.uppercase} onChange={(v) => set({ uppercase: v })} />
        </Row>
      </div>

      <div>
        <SectionLabel className="mb-2">Highlight</SectionLabel>
        <div className="flex gap-2">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Highlight ${s}`}
              aria-pressed={c.highlightColor.toLowerCase() === s.toLowerCase()}
              onClick={() => set({ highlightColor: s })}
              className={cx("size-7 rounded-full transition-shadow", c.highlightColor.toLowerCase() === s.toLowerCase() ? "shadow-[0_0_0_2px_var(--surface-1),0_0_0_4px_var(--text-1)]" : "shadow-[inset_0_0_0_1px_rgb(0_0_0/.25)]")}
              style={{ background: s }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-text-2">{label}</span>
      {children}
    </div>
  );
}
