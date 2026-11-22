"use client";
/**
 * Editor timeline (220px): mono ruler, four 40px tracks (video with transition diamonds and zoom marks,
 * caption word chips, music waveform with beat ticks, SFX pills), downbeat lines through every track,
 * an accent playhead with a time pill. `reveal` (0–4) fills tracks left → right while the edit is planned.
 */
import type { EditPlan } from "@unfold/core";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { IconCaptions, IconMedia, IconMusic, IconSpeaker } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PlayerRef } from "../preview/PlanPlayer";
import { cx, sfxEmoji } from "../ui";

type Frames = { t: number; url: string }[];
const LABEL_W = 92;
const TRACKS = [
  { key: "video", label: "Video", icon: <IconMedia size={14} /> },
  { key: "captions", label: "Captions", icon: <IconCaptions size={14} /> },
  { key: "music", label: "Music", icon: <IconMusic size={14} /> },
  { key: "sfx", label: "Sound FX", icon: <IconSpeaker size={14} /> },
] as const;

const clock = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

/** Deterministic pseudo-waveform for a track id (bars 0..1). */
function waveform(seed: string, n: number) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Array.from({ length: n }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const r = ((h >>> 0) % 1000) / 1000;
    const env = 0.55 + 0.45 * Math.sin((i / n) * Math.PI * 3 + 1.2) ** 2;
    return Math.max(0.12, Math.min(1, env * (0.45 + 0.55 * r)));
  });
}

export function Timeline({
  plan,
  frames,
  reveal = TRACKS.length,
  playerRef,
}: {
  plan?: EditPlan;
  frames: Frames;
  reveal?: number;
  playerRef?: RefObject<PlayerRef | null>;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const pointerCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => pointerCleanup.current?.(), []);

  if (!plan) {
    return (
      <div className="flex h-full flex-col gap-2 px-3 pb-3 pt-2">
        <Skeleton className="h-5 w-full rounded-[6px]" />
        {TRACKS.map((t) => (
          <div key={t.key} className="flex items-center gap-2">
            <span className="flex w-[84px] items-center gap-1.5 text-[12px] text-text-4">
              {t.icon}
              {t.label}
            </span>
            <Skeleton className="h-9 flex-1 rounded-[6px]" />
          </div>
        ))}
      </div>
    );
  }

  const dur = Math.max(0.1, plan.durationSec);
  const pct = (t: number) => `${(Math.max(0, Math.min(dur, t)) / dur) * 100}%`;
  const w = (a: number, b: number) => `${(Math.max(0, b - a) / dur) * 100}%`;
  const step = dur > 40 ? 5 : dur > 16 ? 2 : 1;
  const ticks: number[] = [];
  for (let t = 0; t <= dur + 1e-6; t += step) ticks.push(t);
  const thumb = (srcT: number) => frames.reduce((b, f) => (Math.abs(f.t - srcT) < Math.abs(b.t - srcT) ? f : b), frames[0])?.url;
  const beats = plan.music?.beats ?? [];
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const wave = plan.music ? waveform(plan.music.trackId, 140) : [];

  const seek = (clientX: number) => {
    const el = area.current;
    const p = playerRef?.current;
    if (!el || !p) return;
    const r = el.getBoundingClientRect();
    p.seekTo(Math.min(Math.round(dur * plan.fps) - 1, Math.round(Math.max(0, Math.min(dur, ((clientX - r.left) / r.width) * dur)) * plan.fps)));
  };
  const scrub = (e: React.PointerEvent) => {
    if (!playerRef) return;
    e.preventDefault();
    pointerCleanup.current?.();
    seek(e.clientX);
    const move = (ev: PointerEvent) => seek(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      pointerCleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    pointerCleanup.current = up;
  };

  return (
    <div className="chrome flex h-full select-none px-3 pb-3 pt-1.5 text-[11px]">
      {/* labels */}
      <div className="shrink-0" style={{ width: LABEL_W }}>
        <div className="h-6" />
        {TRACKS.map((t, i) => (
          <div key={t.key} className={cx("mb-1 flex h-10 items-center gap-1.5 pl-1 text-[12px] transition-opacity duration-300", i < reveal ? "text-text-3" : "text-text-4 opacity-50")}>
            {t.icon}
            {t.label}
          </div>
        ))}
      </div>

      {/* lanes */}
      <div ref={area} className="relative min-w-0 flex-1">
        {/* ruler */}
        <div role="group" aria-label="Timeline. Use arrow keys to seek, Home for the start, End for the end." tabIndex={playerRef ? 0 : -1} className="tabular relative h-6 cursor-ew-resize touch-none font-mono text-[10px] text-text-4" onPointerDown={scrub} onKeyDown={(e) => {
          const p = playerRef?.current;
          if (!p || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const delta = (e.shiftKey ? 5 : 1) * plan.fps;
          const frame = e.key === "Home" ? 0 : e.key === "End" ? Math.round(dur * plan.fps) - 1 : p.getCurrentFrame() + (e.key === "ArrowRight" ? delta : -delta);
          p.seekTo(Math.max(0, Math.min(Math.round(dur * plan.fps) - 1, frame)));
        }}>
          {ticks.map((t) => (
            <span key={t} className="absolute top-1 -translate-x-1/2 first:translate-x-0" style={{ left: pct(t) }}>
              {clock(t).replace(/\.0$/, "")}
            </span>
          ))}
          {Array.from({ length: Math.floor(dur / (step / 2)) + 1 }, (_, i) => (
            <span key={i} className="absolute bottom-0 h-1.5 w-px bg-[var(--hairline-strong)]" style={{ left: pct((i * step) / 2) }} />
          ))}
        </div>

        {/* downbeat lines through all tracks */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-6">
          {downbeats.map((b, i) => (
            <span key={i} className="absolute inset-y-0 w-px" style={{ left: pct(b), background: "var(--downbeat)", opacity: 0.35 }} />
          ))}
        </div>

        <div onPointerDown={scrub}>
          {/* video */}
          <Lane on={reveal > 0}>
            {plan.clips.map((c) => (
              <button
                key={c.id}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Video clip, ${clock(c.start)} to ${clock(c.end)}. Seek to clip.`}
                aria-pressed={selected === c.id}
                onClick={() => { setSelected(c.id); playerRef?.current?.seekTo(Math.round(c.start * plan.fps)); }}
                className={cx(
                  "absolute inset-y-0 overflow-hidden rounded-[6px] bg-track-video shadow-[inset_0_0_0_1px_var(--track-video-edge)]",
                  selected === c.id && "z-10 shadow-[0_0_0_2px_var(--accent)]",
                )}
                style={{ left: pct(c.start), width: w(c.start, c.end), backgroundImage: `url(${thumb(c.srcStart)})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }}
                title={`${clock(c.srcStart)}–${clock(c.srcEnd)} of your clip${c.speed !== 1 ? ` · ${c.speed}×` : ""}`}
              >
                {c.speed !== 1 && <span className="tabular absolute right-1 top-1 rounded-[4px] bg-black/60 px-1 font-mono text-[9px] leading-3 text-white">{c.speed}×</span>}
              </button>
            ))}
            {plan.zooms.map((z, i) => (
              <span key={`z${i}`} title={`${z.kind} ${z.scale}×`} className="pointer-events-none absolute -top-0.5 h-1 rounded-full bg-track-zoom-ink" style={{ left: pct(z.start), width: w(z.start, z.end) }} />
            ))}
            {plan.transitions.map((t, i) => (
              <span
                key={`t${i}`}
                title={t.type}
                className="pointer-events-none absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-track-transition-ink shadow-[0_0_0_2px_var(--surface-1)]"
                style={{ left: pct(t.at) }}
              />
            ))}
          </Lane>

          {/* captions */}
          <Lane on={reveal > 1}>
            {plan.captions.enabled &&
              plan.captions.chunks.map((c, i) => (
                <span
                  key={i}
                  className="absolute inset-y-1 overflow-hidden whitespace-nowrap rounded-[6px] bg-track-captions px-1.5 text-[10px] font-medium leading-8 text-track-captions-ink"
                  style={{ left: pct(c.start), width: w(c.start, c.end + 0.03) }}
                  title={c.words.map((x) => x.text).join(" ")}
                >
                  {c.words.map((x) => x.text).join(" ")}
                </span>
              ))}
          </Lane>

          {/* music */}
          <Lane on={reveal > 2}>
            {plan.music && (
              <div className="absolute inset-y-0 left-0 right-0 overflow-hidden rounded-[6px] bg-track-music">
                <div className="absolute inset-x-1 inset-y-1.5 flex items-center gap-px">
                  {wave.map((v, i) => (
                    <span key={i} className="flex-1 rounded-full bg-track-music-wave/70" style={{ height: `${v * 100}%` }} />
                  ))}
                </div>
                {beats.map((b, i) => (
                  <span key={i} className="absolute bottom-0 w-px" style={{ left: pct(b), height: i % 4 === 0 ? "100%" : "35%", background: i % 4 === 0 ? "var(--downbeat)" : "var(--beat)" }} />
                ))}
                <span className="absolute left-1.5 top-1 rounded-[4px] bg-black/35 px-1 text-[10px] font-medium leading-4 text-white/90">
                  {plan.music.title} · <span className="tabular font-mono">{Math.round(plan.music.bpm)} BPM</span>
                </span>
              </div>
            )}
          </Lane>

          {/* sfx */}
          <Lane on={reveal > 3}>
            {plan.sfx.map((s, i) => (
              <span
                key={i}
                title={s.name}
                className="absolute top-1/2 flex h-6 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-track-sfx px-2 text-[10px] font-medium text-track-sfx-ink"
                style={{ left: pct(s.at) }}
              >
                {sfxEmoji(s.sfxId)}
                <span className="max-w-[72px] truncate">{s.name}</span>
              </span>
            ))}
          </Lane>
        </div>

        {playerRef && <Playhead playerRef={playerRef} dur={dur} fps={plan.fps} />}
      </div>
    </div>
  );
}

function Lane({ on, children }: { on: boolean; children: ReactNode }) {
  const [inView, setIn] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setIn(on));
    return () => cancelAnimationFrame(r);
  }, [on]);
  return (
    <div className="relative mb-1 h-10 rounded-[6px] bg-surface-2/60">
      <div className={cx("uf-track-fill absolute inset-0", inView && "is-in")}>{children}</div>
    </div>
  );
}

function Playhead({ playerRef, dur, fps }: { playerRef: RefObject<PlayerRef | null>; dur: number; fps: number }) {
  const line = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let p: PlayerRef | null = null;
    let raf = 0;
    const update = (frame: number) => {
      const t = frame / fps;
      if (line.current) line.current.style.left = `${(Math.min(dur, t) / dur) * 100}%`;
      if (label.current) label.current.textContent = clock(t);
    };
    const on = (e: { detail: { frame: number } }) => update(e.detail.frame);
    const attach = () => {
      p = playerRef.current;
      if (!p) return void (raf = requestAnimationFrame(attach));
      p.addEventListener("frameupdate", on);
      p.addEventListener("seeked", on);
      update(p.getCurrentFrame());
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      p?.removeEventListener("frameupdate", on);
      p?.removeEventListener("seeked", on);
    };
  }, [playerRef, dur, fps]);
  return (
    <div ref={line} className="pointer-events-none absolute bottom-0 top-0 z-20 w-0" style={{ left: 0 }}>
      <div className="uf-playhead-line absolute bottom-0 top-3 -ml-px w-px bg-accent" />
      <span ref={label} className="tabular absolute top-0 -translate-x-1/2 rounded-full bg-accent px-1.5 font-mono text-[10px] leading-4 text-accent-ink">
        0:00.0
      </span>
    </div>
  );
}
