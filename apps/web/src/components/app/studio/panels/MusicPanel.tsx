"use client";
import type { MusicTrack } from "@unfold/core";
import { useEffect, useRef, useState } from "react";
import { SectionLabel } from "@/components/ui/Panel";
import { Slider } from "@/components/ui/Slider";
import { Toggle } from "@/components/ui/Toggle";
import { IconPause, IconPlay } from "@/components/ui/icons";
import { fmtClock } from "@/lib/client/narrate";
import { cx } from "../../ui";
import { Row } from "./CaptionsPanel";
import type { PanelProps } from "./types";

export function MusicPanel({ plan, base, library, set }: PanelProps) {
  const current = plan.music ?? base.music;
  const cur = library.music.find((m) => m.id === current?.trackId);
  const moods = new Set(cur?.moods ?? []);
  const score = (m: MusicTrack) => (cur ? [...m.moods].filter((x) => moods.has(x)).length * 2 - Math.abs(m.bpm - cur.bpm) / 20 + m.energy : m.energy);
  const ranked = [...library.music].filter((m) => m.id !== cur?.id).sort((a, b) => score(b) - score(a));
  const pickedCount = cur ? 2 : 3;
  const picked = [cur, ...ranked.slice(0, pickedCount)].filter(Boolean) as MusicTrack[];
  const rest = ranked.slice(pickedCount);
  const audio = usePreview();
  const drop = cur?.dropAt != null && current ? cur.dropAt - current.trackStart : null;

  return (
    <div className="space-y-5 px-4 pb-4">
      <Row label="Music">
        <Toggle label="Music" checked={!!plan.music} onChange={(v) => set({ music: v })} />
      </Row>
      <div>
        <SectionLabel className="mb-2">Picked for your clip</SectionLabel>
        <div className="space-y-1.5">
          {picked.map((m) => (
            <TrackRow key={m.id} m={m} active={m.id === current?.trackId} big playing={audio.playing === m.id} onPlay={() => audio.toggle(m)} onPick={() => set({ trackId: m.id, music: true })} />
          ))}
        </div>
        {current && plan.music && (
          <div className="mt-3 space-y-2">
            <Slider label="Volume" value={plan.music.volume} onChange={(v) => set({ volume: v, music: true })} format={(v) => `${Math.round(v * 100)}%`} />
            {drop !== null && drop >= 0 && drop <= plan.durationSec && (
              <p className="text-[12px] text-text-3">
                Drop lands at <span className="tabular font-mono text-text-2">{fmtClock(drop)}</span>
              </p>
            )}
          </div>
        )}
      </div>
      {rest.length > 0 && (
        <div>
          <SectionLabel className="mb-2">Library</SectionLabel>
          <div className="space-y-0.5">
            {rest.map((m) => (
              <TrackRow key={m.id} m={m} active={false} playing={audio.playing === m.id} onPlay={() => audio.toggle(m)} onPick={() => set({ trackId: m.id, music: true })} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrackRow({ m, active, big, playing, onPlay, onPick }: { m: MusicTrack; active: boolean; big?: boolean; playing: boolean; onPlay: () => void; onPick: () => void }) {
  return (
    <div className={cx("group flex items-center gap-2.5 rounded-[10px] px-2 transition-colors", big ? "py-2" : "py-1.5", active ? "bg-surface-3 shadow-[inset_0_0_0_1px_var(--hairline-strong)]" : "hover:bg-surface-2")}>
      <button type="button" aria-label={playing ? "Pause preview" : "Play preview"} onClick={onPlay} className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-text-1 shadow-[inset_0_0_0_1px_var(--hairline)]">
        {playing ? <IconPause size={12} /> : <IconPlay size={12} />}
      </button>
      <button type="button" aria-pressed={active} onClick={onPick} className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13px] font-medium text-text-1">{m.title}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-text-3">
          <span className="tabular font-mono">{Math.round(m.bpm)} BPM</span>
          <span className="text-text-4">·</span>
          <span className="truncate">{m.moods.slice(0, 2).join(", ")}</span>
        </div>
      </button>
      {big && <MiniWave seed={m.id} />}
      {active && <span className="text-[11px] text-text-2">In use</span>}
    </div>
  );
}

function MiniWave({ seed }: { seed: string }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  const bars: number[] = [];
  for (let i = 0; i < 18; i++) {
    h = (h * 1103515245 + 12345) | 0;
    bars.push(0.3 + ((Math.abs(h) % 100) / 100) * 0.7 * (0.6 + 0.4 * Math.sin(i / 2)));
  }
  return (
    <span className="flex h-6 w-14 shrink-0 items-center gap-px">
      {bars.map((b, i) => (
        <span key={i} className="flex-1 rounded-full bg-track-music-wave/70" style={{ height: `${b * 100}%` }} />
      ))}
    </span>
  );
}

/** One shared preview player: 10s from the drop. */
function usePreview() {
  const el = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => { el.current?.pause(); clearTimeout(timer.current); }, []);
  return {
    playing,
    toggle(m: MusicTrack) {
      if (!el.current) el.current = new Audio();
      const a = el.current;
      clearTimeout(timer.current);
      if (playing === m.id) {
        a.pause();
        return setPlaying(null);
      }
      a.src = m.url;
      a.currentTime = m.dropAt ?? 0;
      a.volume = 0.6;
      void a.play().catch(() => setPlaying(null));
      a.onended = () => setPlaying(null);
      timer.current = setTimeout(() => {
        if (el.current === a) {
          a.pause();
          setPlaying((p) => (p === m.id ? null : p));
        }
      }, 10_000);
      setPlaying(m.id);
    },
  };
}
