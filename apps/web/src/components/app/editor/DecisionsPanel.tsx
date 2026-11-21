"use client";
import type { Aspect, CaptionPreset, EditPlan, Library } from "@unfold/core";
import type { RefObject } from "react";
import { actions } from "@/lib/client/store";
import type { Overrides } from "@/lib/client/types";
import type { PlayerRef } from "../preview/PlanPlayer";
import { captionFamily, useCaptionFonts } from "../fonts";
import { Chip, Icon, MicroLabel, STYLE_META, Toggle, cx, fmtTime, sfxEmoji } from "../ui";

export const SECTIONS = [
  { key: "captions", label: "Captions", icon: "captions" },
  { key: "music", label: "Music", icon: "music" },
  { key: "sfx", label: "SFX", icon: "sfx" },
  { key: "transitions", label: "Transitions", icon: "transitions" },
  { key: "style", label: "Style", icon: "style" },
  { key: "export", label: "Export", icon: "export" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];

const PRESETS: { id: CaptionPreset; label: string; font: string; upper: boolean; hi: string }[] = [
  { id: "bold-pop", label: "Bold pop", font: captionFamily("bold-pop"), upper: true, hi: "#FFE14D" },
  { id: "clean-pop", label: "Clean", font: captionFamily("clean-pop"), upper: false, hi: "#FFE14D" },
  { id: "meme", label: "Meme", font: captionFamily("meme"), upper: true, hi: "#FFE14D" },
  { id: "story", label: "Story", font: captionFamily("story"), upper: false, hi: "#FF5A1F" },
  { id: "karaoke", label: "Karaoke", font: captionFamily("karaoke"), upper: true, hi: "#7B5CFF" },
];

const PLATFORMS: { label: string; aspect: Aspect }[] = [
  { label: "9:16 vertical", aspect: "9:16" },
  { label: "1:1 square", aspect: "1:1" },
  { label: "16:9 wide", aspect: "16:9" },
];

export function DecisionsPanel({
  id,
  plan,
  base,
  overrides,
  library,
  playerRef,
  manual,
  onExport,
  platform,
  setPlatform,
}: {
  id: string;
  plan: EditPlan;
  base: EditPlan;
  overrides: Overrides;
  library: Library;
  playerRef: RefObject<PlayerRef | null>;
  manual: boolean;
  onExport: () => void;
  platform: string;
  setPlatform: (p: string) => void;
}) {
  useCaptionFonts();
  const set = (o: Overrides) => actions.override(id, o);
  const seek = (t: number) => playerRef.current?.seekTo(Math.round(t * plan.fps));
  const meta = STYLE_META[plan.style];

  return (
    <div className="space-y-1 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={cx("size-2 rounded-full", manual ? "bg-flare" : "bg-violet")} />
        <h2 className="text-[15px] font-semibold">{manual ? "Manual edits" : "Agent decisions"}</h2>
      </div>

      <Section id="captions" title="Captions" on={plan.captions.enabled} onToggle={(v) => set({ captions: v })}>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => set({ captionPreset: p.id, captions: true })}
              className={cx(
                "flex flex-col items-center gap-1 rounded-md border p-1.5 transition-colors duration-[120ms]",
                plan.captions.preset === p.id ? "border-flare bg-flare/5" : "border-border hover:border-ink-muted",
              )}
            >
              <span className="flex h-11 w-full items-center justify-center rounded-[6px] bg-[#1d1d21]">
                <span
                  className="text-[13px] font-black leading-none text-white"
                  style={{ fontFamily: p.font, WebkitTextStroke: "2px #000", paintOrder: "stroke fill", textTransform: p.upper ? "uppercase" : "none" }}
                >
                  so <span style={{ color: p.hi }}>crazy</span>
                </span>
              </span>
              <span className="text-[11px] text-ink-muted">{p.label}</span>
            </button>
          ))}
        </div>
        <Meta>
          {plan.captions.chunks.length} chunks · {plan.captions.position} · emphasis{" "}
          <span className="inline-block size-2.5 rounded-full align-middle" style={{ background: plan.captions.highlightColor }} />
        </Meta>
      </Section>

      <Section id="music" title="Music" on={!!plan.music} disabled={!base.music} onToggle={(v) => set({ music: v })}>
        {base.music ? (
          <>
            <select
              value={plan.music?.trackId ?? base.music.trackId}
              onChange={(e) => set({ trackId: e.target.value, music: true })}
              className="h-9 w-full rounded-sm border border-border bg-surface-2 px-2 text-[13px] outline-none focus:border-flare"
            >
              {library.music.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} · {m.bpm} BPM · {m.moods.join(", ")}
                </option>
              ))}
            </select>
            <label className="mt-3 flex items-center gap-3 text-[13px] text-ink-muted">
              Volume
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={plan.music?.volume ?? base.music.volume}
                onChange={(e) => set({ volume: Number(e.target.value), music: true })}
                className="flex-1 accent-[var(--flare)]"
              />
              <span className="w-9 text-right font-mono text-[12px] tabular">{Math.round((plan.music?.volume ?? base.music.volume) * 100)}%</span>
            </label>
            <Meta>{plan.music ? `${plan.music.beats.length} beat markers · cuts snapped to the grid` : "Muted"}</Meta>
          </>
        ) : (
          <Meta>The agent left music out of this edit. Ask in chat to add a track.</Meta>
        )}
      </Section>

      <Section id="sfx" title="Meme sounds" on={plan.sfx.length > 0} disabled={!base.sfx.length} onToggle={(v) => set({ sfx: v })}>
        <div className="flex flex-wrap gap-1.5">
          {(plan.sfx.length ? plan.sfx : base.sfx).map((s, i) => (
            <button
              key={i}
              onClick={() => seek(s.at)}
              className={cx("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px]", plan.sfx.length ? "bg-track-sfx/15 text-ink" : "bg-surface-2 text-ink-muted line-through")}
            >
              {sfxEmoji(s.sfxId)} {s.name} <span className="font-mono text-[11px] text-ink-muted tabular">{fmtTime(s.at)}</span>
            </button>
          ))}
          {!base.sfx.length && <Meta>No meme sounds in this edit.</Meta>}
        </div>
      </Section>

      <Section id="transitions" title="Transitions" on={plan.transitions.length > 0} disabled={!base.transitions.length} onToggle={(v) => set({ transitions: v })}>
        <div className="flex flex-wrap gap-1.5">
          {base.transitions.map((t, i) => (
            <button
              key={i}
              onClick={() => seek(t.at)}
              className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px]", plan.transitions.length ? "bg-track-transition/15" : "bg-surface-2 text-ink-muted line-through")}
            >
              <span className="size-2 rotate-45 rounded-[1px] bg-track-transition" />
              {t.type} <span className="font-mono text-[11px] text-ink-muted tabular">{fmtTime(t.at)}</span>
            </button>
          ))}
          {!base.transitions.length && <Meta>Straight cuts only.</Meta>}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[13px]">Zoom punches</span>
          <Toggle label="Zoom punches" checked={plan.zooms.length > 0} onChange={(v) => set({ zooms: v })} />
        </div>
        <Meta>{base.zooms.length} zooms · {base.zooms.map((z) => `${z.kind} ${z.scale}×`).join(", ") || "none"}</Meta>
      </Section>

      <Section id="style" title="Style & format">
        <MicroLabel className="mb-2">Platform</MicroLabel>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => (
            <Chip
              key={p.label}
              selected={plan.aspect === p.aspect}
              onClick={() => {
                setPlatform(p.label);
                set({ aspect: p.aspect });
              }}
            >
              {p.label}
            </Chip>
          ))}
        </div>
        <div className="mt-4 rounded-md bg-surface-2 p-3">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <span className="flex gap-0.5">
              {meta.swatch.map((c) => (
                <span key={c} className="size-2.5 rounded-full border border-black/10" style={{ background: c }} />
              ))}
            </span>
            {meta.label}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-ink-muted">{plan.rationale}</p>
          {plan.hookText && (
            <p className="mt-2 text-[13px]">
              <span className="text-ink-muted">Hook:</span> “{plan.hookText}”
            </p>
          )}
        </div>
      </Section>

      <Section id="export" title="Export">
        <p className="text-[13px] text-ink-muted">
          MP4 · {plan.width}×{plan.height} · {plan.fps} fps · {plan.durationSec.toFixed(1)}s
        </p>
        <button onClick={onExport} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-flare text-[14px] font-medium text-flare-ink hover:brightness-105">
          <Icon name="export" className="size-4" /> Export MP4
        </button>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  on,
  disabled,
  onToggle,
  children,
}: {
  id: SectionKey;
  title: string;
  on?: boolean;
  disabled?: boolean;
  onToggle?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section id={`sec-${id}`} className="scroll-mt-3 border-b border-border py-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {onToggle && !disabled && <Toggle label={title} checked={!!on} onChange={onToggle} />}
      </div>
      {children}
    </section>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[12px] leading-5 text-ink-muted">{children}</p>;
}
