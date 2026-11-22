"use client";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import { SectionLabel } from "@/components/ui/Panel";
import { IconUpload } from "@/components/ui/icons";
import { useStore } from "@/lib/client/store";
import type { PanelProps } from "./types";

export function MediaPanel({ plan, frames, seek }: PanelProps) {
  const analysis = useStore((s) => s.analyses[plan.source.videoId] ?? (s.project.analysis?.videoId === plan.source.videoId ? s.project.analysis : null));
  const kept = plan.clips.reduce((a, c) => a + (c.srcEnd - c.srcStart), 0);
  return (
    <div className="space-y-5 px-4 pb-4">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={frames[0]?.url} alt="" className="aspect-[9/16] w-16 shrink-0 rounded-[10px] bg-black object-cover shadow-[inset_0_0_0_1px_var(--hairline)]" />
        <div className="min-w-0 text-[12px] leading-[18px] text-text-2">
          <div className="text-[13px] font-medium text-text-1">Your clip</div>
          {analysis && (
            <div className="tabular font-mono text-[11px] text-text-3">
              {analysis.durationSec.toFixed(1)}s · {analysis.width}×{analysis.height} · {analysis.words.length} words · {analysis.scenes.length} scenes
            </div>
          )}
          <div className="mt-1">
            The edit uses <span className="tabular font-mono text-text-1">{kept.toFixed(1)}s</span> of it in {plan.clips.length} clips.
          </div>
        </div>
      </div>
      <div>
        <SectionLabel className="mb-2">Frames the agent looked at</SectionLabel>
        <div className="grid grid-cols-4 gap-1.5">
          {frames.map((f) => (
            <button key={f.t} type="button" aria-label={`Seek to source frame at ${f.t.toFixed(1)} seconds`} onClick={() => { const c = plan.clips.find((c) => f.t >= c.srcStart && f.t <= c.srcEnd); seek(c ? c.start + (f.t - c.srcStart) / c.speed : 0); }} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt="" className="aspect-[9/16] w-full rounded-[6px] object-cover shadow-[inset_0_0_0_1px_var(--hairline)]" />
              <span className="tabular absolute bottom-1 left-1 rounded-[4px] bg-black/60 px-1 font-mono text-[9px] text-white">{f.t.toFixed(0)}s</span>
            </button>
          ))}
        </div>
      </div>
      <Link href="/app" className={buttonClasses("secondary", "md", "w-full")}>
        <IconUpload size={14} /> Start from another clip
      </Link>
    </div>
  );
}
