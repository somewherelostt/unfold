"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { EditPlan } from "@unfold/core";
import { Button, buttonClasses } from "@/components/ui/Button";
import { SectionLabel } from "@/components/ui/Panel";
import { Toggle } from "@/components/ui/Toggle";
import { IconUpload } from "@/components/ui/icons";
import { useStore } from "@/lib/client/store";
import { mergeSupporting, newBroll, reviseBroll } from "@/lib/client/broll";
import type { BrollShot, SupportingAsset, SupportingUpload } from "@/lib/client/types";
import { SupportingAssets } from "../../SupportingAssets";
import { cx } from "../../ui";
import type { PanelProps } from "./types";

const EMPTY: SupportingUpload[] = [];
export function MediaPanel({ id, plan, base, overrides, frames, set, seek, now, selectedBrollId }: PanelProps) {
  const inventory = useStore((s) => s.supporting[plan.source.videoId] ?? EMPTY);
  const [error, setError] = useState("");
  const assets = mergeSupporting(plan.supporting, inventory.flatMap((a) => a.asset ? [a.asset] : []));
  const shots = overrides.broll ?? base.broll ?? [];
  const disabled = overrides.brollDisabled ?? [];
  function place(asset: SupportingAsset) {
    try {
      const shot = newBroll({ ...plan, supporting: assets }, asset, now());
      set({ supporting: assets, broll: [...shots, shot] });
      setError(""); seek(shot.start);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't place this cutaway."); }
  }
  return <div className="uf-tool-content space-y-5 px-4 pb-4">
    <div className="flex gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {frames[0] && <img src={frames[0].url} alt="Primary narration clip" className="aspect-[9/16] w-14 shrink-0 rounded-[10px] bg-black object-cover" />}
      <div className="min-w-0 text-[12px] leading-[18px] text-text-2"><div className="text-[13px] font-medium text-text-1">Primary clip · narration</div><p className="mt-1">Supporting shots replace the picture. Your primary audio keeps playing.</p></div>
    </div>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    <section aria-label="Cutaway placements" className="space-y-3">
      <SectionLabel>Cutaways in this edit · {plan.broll?.length ?? 0}</SectionLabel>
      {!shots.length && <p className="text-[12px] leading-5 text-text-3">Seek to a moment in the preview, then place an available shot at the playhead. Or ask the agent to use the attached footage where it supports the narration.</p>}
      {shots.map((shot, i) => <Placement key={`${shot.id}:${JSON.stringify(shot)}`} shot={shot} index={i} plan={{ ...plan, supporting: assets }} disabled={disabled.includes(shot.id)} selected={selectedBrollId === shot.id}
        onSeek={() => seek(shot.start)} onToggle={(enabled) => {
          try { if (enabled) reviseBroll({ ...plan, supporting: assets }, shot, {}); set({ brollDisabled: enabled ? disabled.filter((s) => s !== shot.id) : [...disabled, shot.id] }); setError(""); }
          catch (e) { setError(e instanceof Error ? e.message : "Couldn't enable this cutaway."); }
        }}
        onRemove={() => set({ broll: shots.filter((b) => b.id !== shot.id), brollDisabled: disabled.filter((s) => s !== shot.id) })}
        onApply={(next) => set({ supporting: assets, broll: shots.map((b) => b.id === shot.id ? next : b) })} />)}
    </section>
    <SupportingAssets primaryVideoId={plan.source.videoId} planId={id} onUseAsset={place} />
    <details><summary className="cursor-pointer text-[12px] text-text-3">Primary source frames</summary>
      <div className="mt-2 grid grid-cols-4 gap-1.5">{frames.map((f) => <button key={f.t} type="button" aria-label={`Seek to source frame at ${f.t.toFixed(1)} seconds`} onClick={() => { const c = plan.clips.find((c) => f.t >= c.srcStart && f.t < c.srcEnd); if (c) seek(c.start + (f.t - c.srcStart) / c.speed); }} className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={f.url} alt="" className="aspect-video w-full rounded-md object-cover" /><span className="absolute bottom-0 left-0 bg-black/60 px-1 text-[9px] text-white">{f.t.toFixed(0)}s</span>
      </button>)}</div>
    </details>
    <Link href="/app" className={buttonClasses("secondary", "md", "w-full")}><IconUpload size={14} /> Start from another clip</Link>
  </div>;
}

function Placement({ shot, index, plan, disabled, selected, onApply, onRemove, onToggle, onSeek }: {
  shot: BrollShot; index: number; plan: EditPlan; disabled: boolean; selected: boolean;
  onApply: (shot: BrollShot) => void; onRemove: () => void; onToggle: (v: boolean) => void; onSeek: () => void;
}) {
  const placement = useRef<HTMLElement>(null);
  useEffect(() => { if (selected) placement.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); }, [selected]);
  const [assetId, setAsset] = useState(shot.assetId);
  const [start, setStart] = useState(String(shot.start));
  const [duration, setDuration] = useState(String(Number((shot.end - shot.start).toFixed(6))));
  const [sourceStart, setSourceStart] = useState(String(shot.srcStart));
  const [fit, setFit] = useState(shot.fit ?? "cover");
  const [reason, setReason] = useState(shot.reason);
  const [purpose, setPurpose] = useState(shot.purpose);
  const [error, setError] = useState("");
  const supporting = plan.supporting?.find((a) => a.videoId === assetId);
  function apply() {
    try {
      if (reason.trim().length < 8) throw new Error("Explain this cutaway in at least eight characters.");
      const next = reviseBroll(plan, shot, { assetId, start: Number(start), end: Number(start) + Number(duration), srcStart: Number(sourceStart), fit, purpose, reason: reason.trim() });
      onApply(next); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't update this cutaway."); }
  }
  return <article ref={placement} aria-label={`Cutaway ${index + 1}`} className={cx("space-y-2.5 rounded-[10px] bg-surface-2 p-3", selected && "ring-1 ring-accent", disabled && "opacity-70")}>
    <div className="flex items-center justify-between gap-2"><button type="button" onClick={onSeek} className="text-[12px] font-medium text-text-1">Cutaway {index + 1} · {shot.start.toFixed(1)}–{shot.end.toFixed(1)}s</button><Toggle label={`Enable cutaway ${index + 1}`} checked={!disabled} onChange={onToggle} /></div>
    <p className="text-[12px] leading-5 text-text-2">{shot.purpose} · {shot.reason}</p>
    <label className="block text-[12px] text-text-2">Supporting video<select aria-label={`Video for cutaway ${index + 1}`} value={assetId} onChange={(e) => { setAsset(e.target.value); const a = plan.supporting?.find((a) => a.videoId === e.target.value); setSourceStart(String(a?.frames[0]?.t ?? 0)); setReason(`Creator selected ${a?.name ?? "this supporting video"} for this cutaway.`); }} className="mt-1 h-8 w-full min-w-0 rounded-md bg-surface-1 px-2 text-[12px] text-text-1">{plan.supporting?.map((a) => <option key={a.videoId} value={a.videoId}>{a.name}</option>)}</select></label>
    <div className="grid grid-cols-3 gap-2"><Time label="Timeline start" value={start} set={setStart} max={plan.durationSec} /><Time label="Duration" value={duration} set={setDuration} max={plan.durationSec} /><Time label="Source start" value={sourceStart} set={setSourceStart} max={supporting?.durationSec ?? 0} /></div>
    <label className="flex items-center justify-between gap-2 text-[12px] text-text-2">Picture fit<select aria-label={`Picture fit for cutaway ${index + 1}`} value={fit} onChange={(e) => setFit(e.target.value as "cover" | "contain")} className="h-8 rounded-md bg-surface-1 px-2"><option value="cover">Fill frame</option><option value="contain">Show whole frame</option></select></label>
    <label className="flex items-center justify-between gap-2 text-[12px] text-text-2">Purpose<select aria-label={`Purpose for cutaway ${index + 1}`} value={purpose} onChange={(e) => setPurpose(e.target.value as BrollShot["purpose"])} className="h-8 rounded-md bg-surface-1 px-2">{["proof", "process", "context", "reaction", "explanation"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <label className="block text-[12px] text-text-2">Why this shot?<textarea aria-label={`Reason for cutaway ${index + 1}`} maxLength={400} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md bg-surface-1 px-2 py-1.5 text-[12px] text-text-1" /></label>
    {error && <p role="alert" className="text-[12px] leading-5 text-danger">{error}</p>}
    <div className="flex justify-between gap-2"><Button size="sm" variant="secondary" onClick={apply}>Apply cutaway</Button><Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button></div>
  </article>;
}
function Time({ label, value, set, max }: { label: string; value: string; set: (v: string) => void; max: number }) {
  return <label className="text-[12px] leading-4 text-text-2"><span className="block min-h-8">{label} (s)</span><input type="number" aria-label={label} min={0} max={max} step={0.1} value={value} onChange={(e) => set(e.target.value)} className="mt-1 h-8 w-full min-w-0 rounded-md bg-surface-1 px-2 text-[12px] text-text-1" /></label>;
}
