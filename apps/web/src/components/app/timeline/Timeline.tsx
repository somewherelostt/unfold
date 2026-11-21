"use client";
import type { EditPlan } from "@unfold/core";
import { sampleAnalysis } from "@unfold/core";
import { useEffect, useRef, type RefObject } from "react";
import type { PlayerRef } from "../preview/PlanPlayer";
import { cx, fmtTime, sfxEmoji } from "../ui";

type Frames = { t: number; url: string }[];

const TRACKS = [
  { key: "video", label: "Video", color: "bg-track-video" },
  { key: "captions", label: "Captions", color: "bg-track-captions" },
  { key: "music", label: "Music", color: "bg-track-music" },
  { key: "sfx", label: "SFX", color: "bg-track-sfx" },
  { key: "transitions", label: "Transitions", color: "bg-track-transition" },
  { key: "zooms", label: "Zooms", color: "bg-track-zoom" },
] as const;
export type TrackKey = (typeof TRACKS)[number]["key"];

/**
 * Colour-coded multi-track timeline. `reveal` (0–6) animates tracks in one by one (generating view).
 * With `playerRef`, a playhead follows the player and clicks seek.
 */
export function Timeline({
  plan,
  frames = sampleAnalysis.frames,
  reveal = TRACKS.length,
  playerRef,
  compact = false,
  className,
}: {
  plan: EditPlan;
  frames?: Frames;
  reveal?: number;
  playerRef?: RefObject<PlayerRef | null>;
  compact?: boolean;
  className?: string;
}) {
  const dur = Math.max(0.1, plan.durationSec);
  const pct = (t: number) => `${(Math.max(0, Math.min(dur, t)) / dur) * 100}%`;
  const w = (a: number, b: number) => `${(Math.max(0, b - a) / dur) * 100}%`;
  const area = useRef<HTMLDivElement>(null);
  const rowH = compact ? "h-7" : "h-9";

  const seek = (clientX: number) => {
    const el = area.current;
    const p = playerRef?.current;
    if (!el || !p) return;
    const r = el.getBoundingClientRect();
    const t = ((clientX - r.left) / r.width) * dur;
    p.seekTo(Math.round(Math.max(0, Math.min(dur, t)) * plan.fps));
  };

  const ticks: number[] = [];
  const step = dur > 40 ? 10 : dur > 16 ? 2 : 1;
  for (let t = 0; t <= dur + 0.001; t += step) ticks.push(t);

  const thumbFor = (srcT: number) => frames.reduce((best, f) => (Math.abs(f.t - srcT) < Math.abs(best.t - srcT) ? f : best), frames[0])?.url;

  return (
    <div className={cx("flex select-none text-[11px]", className)}>
      {/* labels */}
      <div className="w-[84px] shrink-0 pr-2">
        <div className="h-6" />
        {TRACKS.map((tr, i) => (
          <div key={tr.key} className={cx(rowH, "mb-1 flex items-center gap-1.5 text-ink-muted transition-opacity duration-[240ms]", i < reveal ? "opacity-100" : "opacity-30")}>
            <span className={cx("size-2 rounded-full", tr.color)} />
            {tr.label}
          </div>
        ))}
      </div>

      {/* tracks */}
      <div
        ref={area}
        className={cx("relative min-w-0 flex-1", playerRef && "cursor-pointer")}
        onPointerDown={(e) => {
          if (!playerRef) return;
          seek(e.clientX);
          const move = (ev: PointerEvent) => seek(ev.clientX);
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        {/* ruler */}
        <div className="relative h-6 border-b border-border font-mono text-[10px] text-ink-muted tabular">
          {ticks.map((t) => (
            <span key={t} className="absolute top-1 -translate-x-1/2 first:translate-x-0" style={{ left: pct(t) }}>
              {Math.round(t)}s
            </span>
          ))}
        </div>

        <Row show={reveal > 0} h={rowH}>
          {plan.clips.map((c) => (
            <div
              key={c.id}
              title={`${c.srcStart.toFixed(1)}–${c.srcEnd.toFixed(1)}s${c.speed !== 1 ? ` · ${c.speed}×` : ""}`}
              className="absolute inset-y-0 overflow-hidden rounded-[6px] border-2 border-track-video bg-track-video"
              style={{ left: pct(c.start), width: w(c.start, c.end), backgroundImage: `url(${thumbFor(c.srcStart)})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }}
            >
              {c.speed !== 1 && <span className="absolute right-0.5 top-0.5 rounded-[3px] bg-black/60 px-1 font-mono text-[9px] text-white">{c.speed}×</span>}
            </div>
          ))}
        </Row>

        <Row show={reveal > 1} h={rowH}>
          {plan.captions.enabled &&
            plan.captions.chunks.map((c, i) => (
              <div
                key={i}
                className="absolute inset-y-0.5 overflow-hidden whitespace-nowrap rounded-[4px] bg-track-captions px-1 leading-[inherit] text-white/95"
                style={{ left: pct(c.start), width: w(c.start, c.end + 0.02) }}
                title={c.words.map((x) => x.text).join(" ")}
              >
                <span className={cx("block truncate", compact ? "leading-6" : "leading-8")}>{c.words.map((x) => x.text).join(" ")}</span>
              </div>
            ))}
        </Row>

        <Row show={reveal > 2} h={rowH}>
          {plan.music && (
            <div className="absolute inset-y-0.5 left-0 right-0 overflow-hidden rounded-[4px] bg-track-music/85">
              {plan.music.beats.map((b, i) => (
                <span key={i} className={cx("absolute bottom-0 w-px bg-track-beat", i % 4 === 0 ? "top-0" : "top-1/2")} style={{ left: pct(b) }} />
              ))}
              <span className="relative ml-1.5 font-medium leading-[inherit] text-white">
                <span className={cx("inline-block", compact ? "leading-6" : "leading-8")}>
                  ♪ {plan.music.title} · {plan.music.bpm} BPM
                </span>
              </span>
            </div>
          )}
        </Row>

        <Row show={reveal > 3} h={rowH}>
          {plan.sfx.map((s, i) => (
            <span
              key={i}
              title={s.name}
              className="absolute top-1/2 flex -translate-y-1/2 items-center gap-0.5 whitespace-nowrap rounded-full bg-track-sfx px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ left: pct(s.at) }}
            >
              {sfxEmoji(s.sfxId)}
              {!compact && <span className="hidden xl:inline">{s.name}</span>}
            </span>
          ))}
        </Row>

        <Row show={reveal > 4} h={rowH}>
          {plan.transitions.map((t, i) => (
            <span key={i} title={t.type} className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1" style={{ left: pct(t.at) }}>
              <span className="size-3 rotate-45 rounded-[2px] bg-track-transition" />
              {!compact && <span className="whitespace-nowrap text-[10px] text-ink-muted">{t.type}</span>}
            </span>
          ))}
        </Row>

        <Row show={reveal > 5} h={rowH}>
          {plan.zooms.map((z, i) => (
            <div
              key={i}
              title={`${z.kind} ${z.scale}×`}
              className="absolute inset-y-1 rounded-[4px] bg-track-zoom/85 px-1 text-[10px] leading-5 text-white"
              style={{ left: pct(z.start), width: w(z.start, z.end) }}
            >
              {!compact && <span className="truncate">{z.scale}×</span>}
            </div>
          ))}
        </Row>

        {playerRef && <Playhead playerRef={playerRef} dur={dur} fps={plan.fps} />}
      </div>
    </div>
  );
}

function Row({ show, h, children }: { show: boolean; h: string; children: React.ReactNode }) {
  return (
    <div className={cx(h, "relative mb-1 rounded-[6px] bg-surface-2")}>
      <div
        className="absolute inset-0 transition-[clip-path,opacity] duration-[600ms] ease-out"
        style={{ clipPath: show ? "inset(0 0 0 0)" : "inset(0 100% 0 0)", opacity: show ? 1 : 0 }}
      >
        {children}
      </div>
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
      if (label.current) label.current.textContent = fmtTime(t);
    };
    const onFrame = (e: { detail: { frame: number } }) => update(e.detail.frame);
    const onSeek = (e: { detail: { frame: number } }) => update(e.detail.frame);
    // The player may mount after us; wait for the ref.
    const attach = () => {
      p = playerRef.current;
      if (!p) {
        raf = requestAnimationFrame(attach);
        return;
      }
      p.addEventListener("frameupdate", onFrame);
      p.addEventListener("seeked", onSeek);
      update(p.getCurrentFrame());
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      p?.removeEventListener("frameupdate", onFrame);
      p?.removeEventListener("seeked", onSeek);
    };
  }, [playerRef, dur, fps]);
  return (
    <div ref={line} className="pointer-events-none absolute bottom-0 top-0 z-10 w-0" style={{ left: 0 }}>
      <div className="absolute bottom-0 top-0 -ml-px w-0.5 bg-flare" />
      <span ref={label} className="absolute -top-0.5 -translate-x-1/2 rounded-full bg-flare px-1.5 py-px font-mono text-[10px] text-flare-ink tabular">
        0:00.0
      </span>
    </div>
  );
}
