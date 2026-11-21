"use client";
import type { Aspect, CaptionPreset, EditPlan, Library } from "@unfold/core";
import type { RefObject } from "react";
import { actions } from "@/lib/client/store";
import type { Overrides } from "@/lib/client/types";
import type { PlayerRef } from "../preview/PlanPlayer";
import { captionFamily, useCaptionFonts } from "../fonts";
import { Button, Chip, Icon, MicroLabel, STYLE_META, Toggle, cx, fmtTime, sfxEmoji } from "../ui";

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
    <div className="px-3 pb-3 pt-2">
      <div className="flex h-8 items-center gap-2">
        <span className={cx("size-1.5 rounded-full", manual ? "bg-flare" : "bg-violet")} />
        <h2 className="t-label fg-2">{manual ? "Manual edits" : "Agent decisions"}</h2>
      </div>

      <Section id="captions" title="Captions" on={plan.captions.enabled} onToggle={(v) => set({ captions: v })}>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => set({ captionPreset: p.id, captions: true })}
              className={cx(
                "tint flex flex-col items-center gap-1 rounded-[8px] p-1",
                plan.captions.preset === p.id ? "bg-[var(--flare-10)] shadow-[inset_0_0_0_1px_var(--flare)]" : "hair hair-hover",
              )}
            >
              <span className="flex h-10 w-full items-center justify-center rounded-[5px] bg-[#1a1a1d]">
                <span
                  className="text-[13px] leading-none text-white [font-weight:900]"
                  style={{ fontFamily: p.font, WebkitTextStroke: "2px #000", paintOrder: "stroke fill", textTransform: p.upper ? "uppercase" : "none" }}
                >
                  so <span style={{ color: p.hi }}>crazy</span>
                </span>
              </span>
              <span className={cx("t-meta", plan.captions.preset === p.id ? "text-flare" : "fg-3")}>{p.label}</span>
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
              className="tint layer-2 hair t-body h-8 w-full rounded-[8px] px-2 outline-none"
            >
              {library.music.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} · {m.bpm} BPM · {m.moods.join(", ")}
                </option>
              ))}
            </select>
            <label className="t-label fg-3 mt-3 flex items-center gap-3 font-normal">
              Volume
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={plan.music?.volume ?? base.music.volume}
                onChange={(e) => set({ volume: Number(e.target.value), music: true })}
                className="h-1 flex-1 cursor-pointer accent-[var(--flare)]"
              />
              <span className="t-mono fg-2 w-9 text-right text-[11px]">{Math.round((plan.music?.volume ?? base.music.volume) * 100)}%</span>
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
              className={cx("tint t-label inline-flex h-6 items-center gap-1 rounded-full px-2 font-normal", plan.sfx.length ? "bg-track-sfx/12 fg-1" : "layer-2 fg-4 line-through")}
            >
              {sfxEmoji(s.sfxId)} {s.name} <span className="t-mono fg-3 text-[10px] font-normal">{fmtTime(s.at)}</span>
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
              className={cx("tint t-label inline-flex h-6 items-center gap-1.5 rounded-full px-2 font-normal", plan.transitions.length ? "bg-track-transition/12 fg-1" : "layer-2 fg-4 line-through")}
            >
              <span className="size-2 rotate-45 rounded-[1px] bg-track-transition" />
              {t.type} <span className="t-mono fg-3 text-[10px] font-normal">{fmtTime(t.at)}</span>
            </button>
          ))}
          {!base.transitions.length && <Meta>Straight cuts only.</Meta>}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="t-body fg-2">Zoom punches</span>
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
        <div className="layer-2 mt-3 rounded-[8px] p-3">
          <div className="t-label flex items-center gap-2">
            <span className="flex gap-0.5">
              {meta.swatch.map((c) => (
                <span key={c} className="size-2.5 rounded-full border border-black/10" style={{ background: c }} />
              ))}
            </span>
            {meta.label}
          </div>
          <p className="t-body fg-2 mt-1">{plan.rationale}</p>
          {plan.hookText && (
            <p className="t-body mt-2">
              <span className="fg-3">Hook:</span> “{plan.hookText}”
            </p>
          )}
        </div>
      </Section>

      <Section id="export" title="Export">
        <p className="t-mono t-meta fg-3 font-normal">
          MP4 · {plan.width}×{plan.height} · {plan.fps} fps · {plan.durationSec.toFixed(1)}s
        </p>
        <Button variant="primary" onClick={onExport} className="mt-3 w-full">
          <Icon name="export" /> Export MP4
        </Button>
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
    <section id={`sec-${id}`} className="hair-b scroll-mt-2 py-3 last:shadow-none">
      <div className="mb-2.5 flex h-5 items-center justify-between">
        <h3 className="t-label">{title}</h3>
        {onToggle && !disabled && <Toggle label={title} checked={!!on} onChange={onToggle} />}
      </div>
      {children}
    </section>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <p className="t-meta fg-3 mt-2">{children}</p>;
}
