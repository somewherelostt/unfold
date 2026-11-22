"use client";
import type { SfxItem } from "@unfold/core";
import { useEffect, useRef, useState } from "react";
import { SectionLabel } from "@/components/ui/Panel";
import { Toggle } from "@/components/ui/Toggle";
import { IconPlay, IconPlus, IconX } from "@/components/ui/icons";
import { cx, sfxEmoji } from "../../ui";
import { Row } from "./CaptionsPanel";
import type { PanelProps } from "./types";

/** Category filters share the workspace's quiet, high-contrast controls. */
const CATEGORIES = [
  { key: "impact", label: "Impacts", match: /boom|thud|impact|hit/ },
  { key: "whoosh", label: "Whooshes", match: /whoosh|swoosh|riser|transition/ },
  { key: "meme", label: "Meme", match: /oof|bruh|fail|buzzer|trombone|trumpet|meme|wrong|error|boing/ },
  { key: "reaction", label: "Reactions", match: /laugh|wow|woah|applause|cheer|crowd/ },
  { key: "hype", label: "Hype", match: /airhorn|horn|cash|dj|hype|scratch/ },
  { key: "ui", label: "Pops & dings", match: /pop|ding|bell|camera|shutter|glitch|notification/ },
] as const;

const catOf = (s: SfxItem) => CATEGORIES.find((c) => c.match.test(`${s.id} ${s.tags.join(" ")}`))?.key ?? "ui";
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

export function SfxPanel({ plan, base, overrides, library, set, seek, now }: PanelProps) {
  const [cat, setCat] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const play = (url: string) => {
    audio.current ??= new Audio();
    audio.current.src = url;
    audio.current.volume = 0.7;
    void audio.current.play().catch(() => {});
  };
  const list = library.sfx.filter((s) => !cat || catOf(s) === cat);
  const added = overrides.sfxAdded ?? [];
  const add = (s: SfxItem) => set({ sfx: true, sfxAdded: [...added, { at: Math.max(0, Math.min(plan.durationSec - 1 / plan.fps, Math.round(now() * 100) / 100)), sfxId: s.id, url: s.url, name: s.name, volume: 0.8 }] });
  const remove = (s: (typeof plan.sfx)[number]) => {
    const index = base.sfx.indexOf(s);
    if (index >= 0) set({ sfxRemoved: [...(overrides.sfxRemoved ?? []), index] });
    else set({ sfxAdded: added.filter((x) => x !== s) });
  };

  return (
    <div className="uf-tool-content space-y-5 px-4 pb-4">
      <Row label="Sound effects">
        <Toggle label="Sound effects" checked={plan.sfx.length > 0 || overrides.sfx !== false} onChange={(v) => set({ sfx: v })} />
      </Row>

      <div>
        <SectionLabel className="mb-2">Placed in your edit</SectionLabel>
        {plan.sfx.length ? (
          <div className="space-y-0.5">
            {plan.sfx.map((s, i) => {
              return (
                <div key={i} className="group flex h-8 items-center gap-2 rounded-[8px] px-2 hover:bg-surface-2">
                  <button type="button" onClick={() => seek(s.at)} className="tabular w-11 shrink-0 text-left font-mono text-[12px] text-text-2 hover:text-text-1">
                    {clock(s.at)}
                  </button>
                  <span>{sfxEmoji(s.sfxId)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-1">{s.name}</span>
                    <button type="button" aria-label={`Remove ${s.name}`} onClick={() => remove(s)} className="text-text-3 hover:text-text-1">
                      <IconX size={13} />
                    </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[12px] text-text-3">{base.sfx.length ? "Sound effects are off." : "None yet. Add one at the playhead below."}</p>
        )}
      </div>

      <div>
        <SectionLabel className="mb-2">Library</SectionLabel>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCat(cat === c.key ? null : c.key)}
              aria-pressed={cat === c.key}
              className={cx("h-8 rounded-full px-2.5 text-[12px] font-medium shadow-[inset_0_0_0_1px_var(--hairline)] transition-colors", cat === c.key ? "bg-primary-btn text-primary-btn-ink" : "bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text-1")}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="space-y-0.5">
          {list.map((s) => (
            <div key={s.id} className="group flex h-8 items-center gap-2 rounded-[8px] px-1.5 hover:bg-surface-2">
              <button type="button" aria-label={`Play ${s.name}`} onClick={() => play(s.url)} className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-text-2 shadow-[inset_0_0_0_1px_var(--hairline)] hover:text-text-1">
                <IconPlay size={10} />
              </button>
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-text-3" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-2 group-hover:text-text-1">{s.name}</span>
              <button type="button" aria-label={`Add ${s.name} at playhead`} onClick={() => add(s)} className="flex h-7 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-text-2 hover:bg-surface-3 hover:text-text-1">
                <IconPlus size={11} /> Add at playhead
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
