"use client";
import type { CaptionDesign, CaptionPreset } from "@unfold/core";
import { CAPTION_DESIGNS, resolveCaptionDesign } from "@unfold/video";
import { SectionLabel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Toggle } from "@/components/ui/Toggle";
import { Slider } from "@/components/ui/Slider";
import { useCaptionFonts } from "../../fonts";
import { cx } from "../../ui";
import type { PanelProps } from "./types";

const PRESETS: { id: CaptionPreset; label: string; upper: boolean; box?: boolean }[] = [
  { id: "clean-pop", label: "Clean", upper: false },
  { id: "story", label: "Story", upper: false },
  { id: "karaoke", label: "Karaoke", upper: false, box: true },
  { id: "bold-pop", label: "Bold pop", upper: true },
  { id: "meme", label: "Meme", upper: true },
];
const SWATCHES = ["#FFE14D", "#FF5A1F", "#3CDDA7", "#8F75FF", "#FFFFFF"];

export function CaptionsPanel({ plan, overrides, set }: PanelProps) {
  useCaptionFonts();
  const c = plan.captions;
  const design = { ...CAPTION_DESIGNS[c.preset], ...c.design };
  const setDesign = (patch: Partial<CaptionDesign>) => set({ captionDesign: { ...design, ...patch } });
  const line = (c.chunks.find((x) => x.words.length >= 2) ?? c.chunks[0])?.words.slice(0, 3) ?? [{ text: "this", emphasis: false }, { text: "is", emphasis: false }, { text: "insane", emphasis: true }];
  const lit = Math.max(0, line.findIndex((w) => w.emphasis));
  const wpl = overrides.wordsPerLine ?? Math.max(1, Math.min(4, Math.round(c.chunks.reduce((a, x) => a + x.words.length, 0) / Math.max(1, c.chunks.length))));
  return (
    <div className="uf-tool-content space-y-5 px-4 pb-4">
      <p className="uf-tool-intro">Make speech easy to follow. Choose a look, then refine the details.</p>
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => {
          const look = resolveCaptionDesign({ preset: p.id });
          return (
          <button
            key={p.id}
            type="button"
            aria-label={`${p.label} captions`}
            aria-pressed={c.preset === p.id}
            onClick={() => set({ captionPreset: p.id, captionDesign: CAPTION_DESIGNS[p.id], captions: true, uppercase: p.upper })}
            className={cx(
              "group relative flex h-[84px] flex-col items-center justify-center overflow-hidden rounded-[12px] bg-[#0d0d10] transition-shadow",
              c.preset === p.id ? "shadow-[0_0_0_2px_var(--accent)]" : "shadow-[inset_0_0_0_1px_var(--hairline)] hover:shadow-[inset_0_0_0_1px_var(--hairline-strong)]",
            )}
          >
            <span className="px-2 text-center text-[17px] leading-tight" style={{ fontFamily: look.family, fontWeight: look.fontWeight, textTransform: p.upper ? "uppercase" : "none", color: look.textColor, WebkitTextStroke: look.outline ? "0.6px #000" : undefined, paintOrder: "stroke fill" }}>
              {line.map((w, i) => (
                <span key={i} style={i === lit && look.highlightMode !== "none" ? (look.highlightMode === "background" ? { background: c.highlightColor, color: "#111", WebkitTextStroke: "0", padding: "0 3px", borderRadius: 2 } : { color: c.highlightColor }) : undefined}>
                  {w.text}
                  {i < line.length - 1 ? " " : ""}
                </span>
              ))}
            </span>
            <span className="absolute bottom-1.5 left-2 text-[10px] text-white/55">{p.label}</span>
          </button>
        ); })}
      </div>
      {!c.chunks.length && <p className="text-[12px] text-text-3">No speech was found in this clip. Your hook text can still appear at the start.</p>}

      <div className="space-y-3">
        <Row label="Captions">
          <Toggle label="Captions" checked={c.enabled} onChange={(v) => set({ captions: v })} />
        </Row>
        <Row label="Words per line">
          <Segmented label="Words per line" mono className="w-[148px]" options={["1", "2", "3", "4"].map((v) => ({ value: v, label: v }))} value={String(wpl)} onChange={(v) => set({ wordsPerLine: Number(v) })} />
        </Row>
        <Row label="Position">
          <Segmented label="Caption position"
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

      <details className="uf-tool-disclosure">
        <summary>Typography &amp; motion</summary><div className="space-y-3 pt-4">
        <Row label="Typeface">
          <Segmented label="Caption typeface" className="w-[196px]" value={design.typeface} options={[{ value: "sans", label: "Sans" }, { value: "serif", label: "Serif" }, { value: "rounded", label: "Soft" }, { value: "condensed", label: "Tall" }]} onChange={(v) => setDesign({ typeface: v })} />
        </Row>
        <Slider label="Size" value={design.fontScale} min={0.65} max={1.3} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setDesign({ fontScale: v })} />
        <Row label="Weight">
          <Segmented label="Caption weight" className="w-[196px]" value={design.weight} options={[{ value: "regular", label: "Regular" }, { value: "medium", label: "Medium" }, { value: "bold", label: "Bold" }]} onChange={(v) => setDesign({ weight: v })} />
        </Row>
        <Row label="Emphasis">
          <Segmented label="Caption emphasis" className="w-[168px]" value={design.highlightMode} options={[{ value: "none", label: "None" }, { value: "word", label: "Word" }, { value: "background", label: "Fill" }]} onChange={(v) => setDesign({ highlightMode: v })} />
        </Row>
        <Row label="Motion">
          <Segmented label="Caption motion" className="w-[196px]" value={design.animation} options={[{ value: "none", label: "None" }, { value: "fade", label: "Fade" }, { value: "rise", label: "Rise" }, { value: "pop", label: "Pop" }]} onChange={(v) => setDesign({ animation: v })} />
        </Row>
        <Row label="Outline"><Toggle label="Caption outline" checked={design.outline} onChange={(v) => setDesign({ outline: v })} /></Row>
        <Row label="Text colour"><input type="color" aria-label="Caption text colour" value={design.textColor} onChange={(e) => setDesign({ textColor: e.target.value })} className="h-7 w-9 cursor-pointer rounded-md bg-transparent p-0" /></Row>
      </div></details>

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
    <div className="uf-control-row flex items-center justify-between gap-3">
      <span className="text-[13px] text-text-2">{label}</span>
      {children}
    </div>
  );
}
