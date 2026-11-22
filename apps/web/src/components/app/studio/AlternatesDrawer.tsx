"use client";
/** Secondary: alternate versions of the edit in a bottom drawer above the timeline. Current = accent ring. */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { actions, isActive, useStore } from "@/lib/client/store";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Shimmer } from "@/components/ui/Shimmer";
import { Skeleton } from "@/components/ui/Skeleton";
import { IconSparkle, IconX } from "@/components/ui/icons";
import { cx } from "../ui";

const STYLE_TAG: Record<string, string> = { "gaming-montage": "Montage", "podcast-clip": "Podcast", storytime: "Story", chaos: "Chaos", custom: "Custom" };

export function AlternatesDrawer({ id, frames, onClose, className = "", style }: { id: string; frames: { t: number; url: string }[]; onClose: () => void; className?: string; style?: React.CSSProperties }) {
  const router = useRouter();
  const root = useStore((s) => s.altRoot[id] ?? id);
  const run = useStore((s) => s.alts[root]);
  const plans = useStore((s) => s.plans);
  const active = isActive(run);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, [active]);
  const waited = run?.queuedAt && now ? Math.max(0, Math.floor((now - run.queuedAt) / 1000)) : 0;
  const ids = [root, ...(run?.slots ?? [])];
  const poster = (t: number) => frames.reduce((b, f) => (Math.abs(f.t - t) < Math.abs(b.t - t) ? f : b), frames[0])?.url;

  return (
    <Panel className={cx("uf-drawer-in flex flex-col overflow-hidden", className)} style={style}>
      <div className="flex h-11 shrink-0 items-center gap-2 px-4">
        <span className="shrink-0 text-[13px] font-medium">Alternate versions</span>
        {active ? (
          <span role="status" className="hidden text-[12px] sm:inline">
            <Shimmer>
              {run.status === "queued" ? (
                <>
                  Waiting for alternate edits · <span className="tabular font-mono">{String(Math.floor(waited / 60)).padStart(2, "0")}:{String(waited % 60).padStart(2, "0")}</span> elapsed
                </>
              ) : (
                "Receiving alternate edits…"
              )}
            </Shimmer>
          </span>
        ) : run?.status === "error" ? (
          <span className="text-[12px] text-danger">{run.error}</span>
        ) : (
          <span className="hidden truncate text-[12px] text-text-3 sm:inline">{run?.warning ?? run?.error ?? "Optional versions based on your footage"}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {active ? (
            <Button size="sm" variant="ghost" className="h-7" onClick={() => actions.cancel({ alternatesOf: root })}>
              Cancel
            </Button>
          ) : !run?.interrupted && run?.retryable !== false && run?.errorCode !== "AUTH_REJECTED" ? (
            <Button size="sm" variant="ghost" className="h-7" onClick={() => void actions.generateAlternates(root)}>
              <IconSparkle size={14} /> {run ? (run.status === "error" ? (run.errorCode === "RATE_LIMITED" || run.errorCode === "UNAVAILABLE" ? "Try again later" : "Retry") : "Three more") : "Make three"}
            </Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
            <IconX size={14} />
          </Button>
        </div>
      </div>
      <div className="thin-scrollbar flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4">
        {ids.map((pid, i) => {
          const err = i > 0 ? run?.slotErrors[i - 1] : null;
          if (!pid)
            return err ? (
              <div key={`e${i}`} title={err} className="grid aspect-[9/16] h-full shrink-0 place-items-center rounded-[12px] p-2 text-center text-[11px] text-text-3 shadow-[inset_0_0_0_1px_var(--hairline)]">
                Didn&apos;t land
              </div>
            ) : active ? (
              <Skeleton key={`s${i}`} className="aspect-[9/16] h-full shrink-0 rounded-[12px]" />
            ) : <div key={`s${i}`} className="grid aspect-[9/16] h-full shrink-0 place-items-center rounded-[12px] bg-surface-2 p-2 text-center text-[11px] text-text-3">Not generated</div>;
          const p = plans[pid]?.base;
          if (!p) return null;
          const current = pid === id;
          return (
            <button
              key={pid}
              type="button"
              aria-pressed={current}
              aria-label={`${i === 0 ? "Original" : p.title}${current ? ", current edit" : ""}`}
              onClick={() => !current && router.push(`/app/edit/${pid}`)}
              className={cx("uf-rise group flex h-full shrink-0 gap-3 rounded-[14px] p-1.5 pr-3 text-left transition-colors", current ? "bg-surface-2 shadow-[0_0_0_2px_var(--accent)]" : "hover:bg-surface-2")}
              style={{ ["--i" as string]: i }}
            >
              <span className="relative aspect-[9/16] h-full shrink-0 overflow-hidden rounded-[10px] bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={poster(p.clips[0]?.srcStart ?? 0)} alt="" className="absolute inset-0 size-full object-cover" />
                {p.hookText && <span className="absolute inset-x-1 top-2 line-clamp-2 text-center text-[8px] font-bold uppercase leading-tight text-white [text-shadow:0_1px_2px_#000]">{p.hookText}</span>}
              </span>
              <span className="flex w-[132px] min-w-0 flex-col py-1">
                <span className="truncate text-[13px] font-medium text-text-1">{i === 0 ? "Original" : p.title}</span>
                <span className="mt-0.5 line-clamp-3 text-[11px] leading-[15px] text-text-3">{i === 0 ? p.title : p.rationale}</span>
                <span className="mt-auto flex flex-wrap gap-1">
                  {[STYLE_TAG[p.style], p.captions.preset.replace("-", " "), p.music ? `${Math.round(p.music.bpm)} BPM` : null, `${p.durationSec.toFixed(0)}s`].filter(Boolean).map((t) => (
                    <span key={t} className="rounded-full bg-surface-3 px-1.5 text-[10px] leading-4 text-text-2">
                      {t}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
