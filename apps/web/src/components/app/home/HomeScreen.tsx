"use client";
/** Source-first workspace. Existing upload, draft recovery and generation contracts stay in the store. */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { actions, isActive, useStore, type PlanEntry } from "@/lib/client/store";
import type { PromptSubmit } from "@/components/ui/PromptShell";
import { abandonPromptDraft, adoptPromptSearch, recoverPromptDraft } from "@/lib/client/draft";
import { Button } from "@/components/ui/Button";
import { IconArrowRight, IconMedia, IconUpload, IconX } from "@/components/ui/icons";
import { AppHeader } from "../AppHeader";
import { SupportingAssets } from "../SupportingAssets";

import { SourceUpload } from "./SourceUpload";
import { EditBrief } from "./EditBrief";

export function HomeScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const project = useStore((s) => s.project);
  const running = useStore((s) => isActive(s.run));
  const plans = useStore((s) => s.plans);
  const altRoot = useStore((s) => s.altRoot);
  const draftId = params.get("draft");
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    const key = params.toString();
    if (draftId || !key || adopted.current === key) return;
    adopted.current = key;
    if (!adoptPromptSearch(params)) return;
    const clean = new URLSearchParams(params);
    for (const field of ["prompt", "style", "aspect"]) clean.delete(field);
    router.replace(`/app${clean.size ? `?${clean}` : ""}`, { scroll: false });
  }, [draftId, params, router]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [settledDraft, setSettledDraft] = useState<string | null>(null);
  const recovering = !!draftId && settledDraft !== draftId;
  const [recoveryAttempt, retryRecovery] = useState(0);
  useEffect(() => {
    if (!draftId) return;
    let active = true;
    void recoverPromptDraft(draftId).then(() => {
      if (active) { setSettledDraft(draftId); router.replace("/app", { scroll: false }); }
    }, (e: unknown) => {
      if (active) { setSettledDraft(draftId); setDraftError(e instanceof Error ? e.message : "Couldn't recover your clip. Attach it again."); }
    });
    return () => { active = false; };
  }, [draftId, recoveryAttempt, router]);

  function start(v: PromptSubmit) {
    if (running) return router.push("/app/new");
    if (recovering) throw new Error("Your attached clip is still being recovered. Try again when it is ready.");
    if (draftError && !project.videoId) throw new Error("Attach your clip again or retry recovery before starting.");
    const url = v.prompt.match(/https?:\/\/\S+/)?.[0] ?? "";
    const text = v.prompt.replace(url, "").replace(/copy the style of this video:?\s*$/i, "").trim();
    if (url) actions.setReferenceUrl(url);
    actions.setPrompt(text);
    actions.setPromptStyle(v.style);
    actions.setStyle(null);
    actions.setAspect(v.aspect as "9:16" | "1:1" | "16:9");
    void actions.generate();
    router.push("/app/new");
  }

  function attach(file: File | null) {
    setDraftError(null);
    if (draftId) { abandonPromptDraft(draftId); setSettledDraft(draftId); router.replace("/app", { scroll: false }); }
    if (file) void actions.upload(file);
    else actions.clearUpload();
  }

  // Recent edits: one card per edit (alternate takes stay inside their edit).
  const recent = Object.entries(plans)
    .filter(([id]) => !altRoot[id] || altRoot[id] === id)
    .reverse()
    .slice(0, 8);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="uf-page uf-home-page">
        <div className="uf-home-workspace">
          <section className="uf-create-panel" aria-label="Create an edit">
            <header className="uf-create-header"><h1>Create an edit</h1><p>Start with your footage. Make it yours.</p>{running && <Link href="/app/new" className="uf-text-link">View edit in progress <IconArrowRight /></Link>}</header>
            <section className="uf-create-source" aria-labelledby="source-heading">
              <div className="uf-card-heading"><h2 id="source-heading">Your footage</h2><span className="uf-meta">Required</span></div>
              <SourceUpload onAttach={attach} disabled={running || recovering} />
              {project.videoId && <div className="mt-4 border-t border-hairline pt-4"><SupportingAssets primaryVideoId={project.videoId} /></div>}
            </section>
            <section className="uf-create-brief" aria-labelledby="brief-heading">
              <h2 id="brief-heading" className="sr-only">Edit direction</h2>
              <EditBrief defaultText={params.get("prompt") ?? project.prompt} defaultStyle={params.get("style") ?? project.promptStyle ?? "Auto"} defaultAspect={params.get("aspect") ?? project.aspect}
                busy={project.analyzing || recovering} hasClip={!!project.videoId} disabled={running || recovering || project.analyzing || !project.videoId || !!draftError} onSubmit={start} />
              {recovering && <p role="status" className="uf-status-card mt-3">Recovering your attached clip…</p>}
              {draftError && <div role="alert" className="uf-status-card mt-3" data-tone="error"><p>{draftError}</p><Button size="sm" variant="secondary" onClick={() => { setSettledDraft(null); setDraftError(null); retryRecovery((n) => n + 1); }}>Retry recovery</Button></div>}
              <Inspiration />
            </section>
          </section>
          <section className="uf-library" aria-labelledby="recent-heading">
            <div className="uf-section-heading"><div><p className="uf-kicker">Your workspace</p><h2 id="recent-heading">Recent edits</h2><p>Pick up where you left off.</p></div>{recent.length > 0 && <span className="uf-count">{recent.length} {recent.length === 1 ? "edit" : "edits"}</span>}</div>
            {recent.length > 0 ? <div className="uf-edit-grid">{recent.map(([id, entry]) => <RecentCard key={id} id={id} entry={entry} />)}</div> : <div className="uf-library-empty"><div><IconMedia size={28} /><h3>Your work belongs here.</h3><p>Upload a clip to create your first edit. Preview it, refine the details and export when you’re ready.</p></div></div>}
          </section>
        </div>
      </main>
    </div>
  );
}

function Inspiration() {
  const p = useStore((s) => s.project);
  const input = useRef<HTMLInputElement>(null);
  const file = p.referenceUrl.startsWith("upload:");
  return (
    <details className="mt-4 rounded-[14px] bg-surface-1 px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--hairline)]" open={p.referenceUrl || p.referenceNotice ? true : undefined}>
      <summary className="cursor-pointer text-[13px] font-medium text-text-2 hover:text-text-1">Add an inspiration video <span className="font-normal text-text-3">· optional</span></summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {file ? <span className="min-w-0 flex-1 truncate text-[13px] text-text-1">{p.referenceUrl.slice(7)}</span> : <input type="url" aria-label="Inspiration video link" placeholder="Paste a video link…" value={p.referenceUrl} onChange={(e) => actions.setReferenceUrl(e.target.value)} className="uf-field h-9 min-w-[160px] flex-1" />}
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()}><IconUpload size={13} /> Attach video</Button>
        {p.referenceUrl && <Button size="icon-sm" variant="ghost" aria-label="Remove inspiration" onClick={() => actions.setReferenceFile(null)}><IconX size={13} /></Button>}
        <input ref={input} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) actions.setReferenceFile(f); e.target.value = ""; }} />
      </div>
      {p.referenceNotice && <p role="status" className="mt-2 text-[12px] text-text-3">{p.referenceNotice}</p>}
      <p className="mt-2 text-[12px] leading-5 text-text-3">Use a link, or attach the video if the link cannot be opened.</p>
    </details>
  );
}

/** Verify ownership before loading any thumbnail. Unavailable local drafts remain discoverable. */
function RecentCard({ id, entry }: { id: string; entry: PlanEntry }) {
  const access = useStore((s) => s.planAccess[id]);
  const frames = useStore((s) => s.analyses[entry.base.source.videoId]?.frames);
  const [failedPoster, setFailedPoster] = useState("");
  useEffect(() => { if (!access) void actions.ensurePlan(id); }, [access, id]);
  const poster = access === "ready" ? posterFor(entry.base.clips[0]?.srcStart ?? 0, frames ?? []) : undefined;
  return <Link href={`/app/edit/${id}`} aria-label={`Open ${entry.name}`} className="uf-edit-card">
    <div className="uf-edit-thumbnail">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {poster && failedPoster !== poster ? <img src={poster} alt="" onError={() => setFailedPoster(poster)} /> : <IconMedia size={28} />}
      <span>{entry.base.aspect} · {entry.base.durationSec.toFixed(1)}s</span>
    </div>
    <div className="p-3.5"><h3>{entry.name}</h3><p>{access === "error" ? "Unavailable · local draft preserved" : access === "ready" ? "Open in studio" : "Checking access…"}</p></div>
  </Link>;
}

export function posterFor(t: number, frames: { t: number; url: string }[]) {
  return frames.reduce((b, f) => (Math.abs(f.t - t) < Math.abs(b.t - t) ? f : b), frames[0])?.url;
}
