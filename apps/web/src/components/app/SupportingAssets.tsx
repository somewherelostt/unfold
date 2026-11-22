"use client";
import { useEffect, useRef, useState } from "react";
import { actions, useStore } from "@/lib/client/store";
import type { SupportingAsset, SupportingUpload } from "@/lib/client/types";
import { Button } from "@/components/ui/Button";
import { IconUpload } from "@/components/ui/icons";

const EMPTY: SupportingUpload[] = [];

export function SupportingAssets({ primaryVideoId, planId, onUseAsset }: { primaryVideoId: string; planId?: string; onUseAsset?: (asset: SupportingAsset) => void }) {
  const items = useStore((s) => s.supporting[primaryVideoId] ?? EMPTY);
  const error = useStore((s) => s.supportingErrors[primaryVideoId]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { void actions.loadSupporting(primaryVideoId); }, [primaryVideoId]);
  const selected = items.filter((a) => a.selected !== false && a.status !== "cancelled").length;
  function attach(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) void actions.uploadSupporting(primaryVideoId, file, planId);
  }
  return <section aria-label="Supporting footage" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-[13px] font-medium text-text-1">Supporting footage <span className="font-normal text-text-3">· optional</span></h3><p className="mt-1 text-[12px] leading-5 text-text-2">Upload up to four videos for muted cutaways. Your main clip keeps the narration.</p></div>
      <Button size="sm" variant="secondary" onClick={() => input.current?.click()}><IconUpload size={13} /> Add videos</Button>
    </div>
    <input ref={input} type="file" aria-label="Add supporting videos" multiple accept="video/*" hidden onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
    {error && <p role="alert" className="text-[12px] text-danger">{error} <button type="button" className="underline" onClick={() => void actions.loadSupporting(primaryVideoId)}>Retry loading</button></p>}
    {selected > 4 && <p role="alert" className="text-[12px] text-danger">Choose at most four supporting videos before generating.</p>}
    {!items.length && <p className="rounded-[10px] border border-dashed border-[var(--hairline-strong)] p-3 text-[12px] leading-5 text-text-3">Add product details, a process shot, context or a reaction. The edit can use them when they help your story.</p>}
    <div className="space-y-2">{items.map((item) => <AssetCard key={item.id} item={item} primaryVideoId={primaryVideoId} planId={planId} onUseAsset={onUseAsset} />)}</div>
  </section>;
}

function AssetCard({ item, primaryVideoId, planId, onUseAsset }: { item: SupportingUpload; primaryVideoId: string; planId?: string; onUseAsset?: (asset: SupportingAsset) => void }) {
  const [description, setDescription] = useState(item.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = item.status === "uploading" || item.status === "analyzing";
  const retry = useRef<HTMLInputElement>(null);
  async function save() {
    setSaving(true); setError("");
    try { await actions.describeSupporting(primaryVideoId, item.id, description, planId); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't save that description."); }
    finally { setSaving(false); }
  }
  async function remove() {
    setError("");
    try { await actions.deleteSupporting(primaryVideoId, item.id); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't remove this upload."); }
  }
  return <article className="min-w-0 uf-asset-card space-y-2 rounded-[10px] bg-surface-2/70 p-3">
    <div className="flex min-w-0 gap-2.5">
      <div className="aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {item.asset?.frames[0] && <img src={item.asset.frames[0].url} alt={`Preview of ${item.name}`} className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p title={item.name} className="truncate text-[12px] font-medium text-text-1">{item.name}</p>
        <p role="status" className="text-[12px] text-text-3">{item.status === "uploading" ? `Uploading ${Math.round(item.progress * 100)}%` : item.status === "analyzing" ? "Finding frames…" : item.asset ? `${item.asset.durationSec.toFixed(1)}s · ${item.asset.width}×${item.asset.height} · muted cutaway` : item.status === "cancelled" ? item.videoId ? "Stopped waiting · uploaded media retained" : "Upload stopped" : "Upload unavailable"}</p>
        {active ? <button type="button" className="mt-1 text-[12px] text-text-2 underline underline-offset-4 hover:text-text-1" onClick={() => actions.cancelSupporting(primaryVideoId, item.id)}>{item.status === "analyzing" ? "Stop waiting" : "Cancel upload"}</button> : item.status === "ready" ? <label className="mt-1 flex items-center gap-1.5 text-[12px] text-text-2"><input type="checkbox" className="accent-[var(--primary-btn)]" checked={item.selected !== false} onChange={(e) => actions.selectSupporting(primaryVideoId, item.id, e.target.checked)} /> Use in generation</label> : item.videoId ? <button type="button" className="mt-1 text-[12px] text-text-2 underline underline-offset-4 hover:text-text-1" onClick={() => void actions.retrySupporting(primaryVideoId, item.id, planId)}>Retry analysis</button> : <button type="button" className="mt-1 text-[12px] text-text-2 underline underline-offset-4 hover:text-text-1" onClick={() => retry.current?.click()}>Choose file again</button>}
      </div>
    </div>
    {item.status === "uploading" && <progress aria-label={`Upload progress for ${item.name}`} max={1} value={item.progress} className="h-1 w-full accent-[var(--primary-btn)]" />}
    {item.error && <p role="alert" className="break-words text-[12px] leading-5 text-danger">{item.error}</p>}
    {!active && <button type="button" className="text-[12px] text-text-2 underline underline-offset-4 hover:text-text-1" onClick={() => void remove()}>Remove unused upload</button>}
    <input ref={retry} type="file" aria-label={`Replace failed upload ${item.name}`} accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { actions.cancelSupporting(primaryVideoId, item.id); void actions.uploadSupporting(primaryVideoId, f, planId); } e.target.value = ""; }} />
    {item.asset && <details className="uf-asset-description"><summary>{item.description ? "Edit description" : "Describe this footage"}</summary><div className="mt-2 space-y-2">
      <label className="block text-[12px] text-text-2">What does this show?
        <textarea aria-label={`Description for ${item.name}`} maxLength={500} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Close-up of the product texture in natural light" className="mt-1 w-full resize-y rounded-md bg-surface-1 px-2 py-1.5 text-[12px] text-text-1 outline-none focus:ring-1 focus:ring-text-3" />
      </label>
      <div className="flex flex-wrap gap-2">
        {description !== item.description && <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save description"}</Button>}

      </div>
    </div></details>}
    {item.asset && onUseAsset && <Button size="sm" variant="secondary" className="w-full" onClick={() => onUseAsset(item.asset!)}>Place at playhead</Button>}
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
  </article>;
}
