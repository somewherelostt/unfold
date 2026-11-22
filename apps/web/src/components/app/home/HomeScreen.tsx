"use client";
/** /app: centred prompt shell + chips, clip status, recent edits. */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { sampleAnalysis } from "@unfold/core";
import { actions, isActive, useStore, type PlanEntry } from "@/lib/client/store";
import { PromptShell, type PromptSubmit } from "@/components/ui/PromptShell";
import { abandonPromptDraft, recoverPromptDraft } from "@/lib/client/draft";
import { Button } from "@/components/ui/Button";
import { SectionLabel } from "@/components/ui/Panel";
import { Shimmer } from "@/components/ui/Shimmer";
import { VideoCard } from "@/components/ui/VideoCard";
import { IconArrowRight, IconUpload, IconX } from "@/components/ui/icons";
import { AppHeader } from "../AppHeader";

const BRIEFS = ["Make my gameplay go viral", "Add captions that pop, word by word", "Cut this into a 15s hook-first clip", "Hype reel with whip pans and a big drop"];

export function HomeScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const project = useStore((s) => s.project);
  const running = useStore((s) => isActive(s.run));
  const plans = useStore((s) => s.plans);
  const altRoot = useStore((s) => s.altRoot);
  const draftId = params.get("draft");
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
      <main className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col px-4 pb-24 pt-14 sm:px-8 sm:pt-24">
        <div className="mx-auto w-full max-w-[640px] text-center">
          <h1 className="uf-rise font-display text-[38px] leading-[42px] tracking-[-0.02em] text-text-1 sm:text-[52px] sm:leading-[56px]">
            What should this clip <em className="italic">become</em>?
          </h1>
          <p className="uf-rise mx-auto mt-3 max-w-[480px] text-[15px] leading-6 text-text-2 [--i:1]">
            Drop in raw footage. Unfold edits it with captions, beat-synced music, transitions and sound effects.
          </p>
        </div>

        <div className="uf-rise mx-auto mt-9 w-full max-w-[640px] [--i:2]">
          <PromptShell
            briefs={params.get("prompt") || project.prompt ? undefined : BRIEFS}
            defaultText={params.get("prompt") ?? project.prompt}
            defaultStyle={params.get("style") ?? project.promptStyle ?? "Auto"}
            defaultAspect={params.get("aspect") ?? project.aspect}
            working={running || recovering || project.analyzing}
            onAttach={attach}
            onTextChange={(t) => actions.setPrompt(t)}
            onSubmit={start}
          />
          <ClipStatus />
          {recovering && <p role="status" className="mt-3 text-center text-[12px] text-text-3">Recovering your attached clip…</p>}
          {draftError && <div role="alert" className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[12px] text-danger"><span>{draftError}</span><Button size="sm" variant="ghost" onClick={() => { setSettledDraft(null); setDraftError(null); retryRecovery((n) => n + 1); }}>Retry recovery</Button></div>}
          <Inspiration />
        </div>

        <section className="mt-20">
          <div className="mb-4 flex items-baseline justify-between">
            <SectionLabel>Recent edits</SectionLabel>
            {recent.length > 0 && <span className="tabular font-mono text-[11px] text-text-3">{recent.length}</span>}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
            <DropTile onAttach={attach} />
            {recent.map(([id, e], i) => (
              <RecentCard key={id} id={id} entry={e} i={i} />
            ))}
            {recent.length === 0 && <SampleTile disabled={running || recovering || !!draftError} onStart={() => { actions.clearUpload(); start({ prompt: "", file: null, style: "Auto", aspect: "9:16" }); }} />}
          </div>
        </section>
      </main>
    </div>
  );
}

/** Upload / analysis status under the shell. */
function ClipStatus() {
  const p = useStore((s) => s.project);
  if (!p.fileName) return p.analyzeError ? <p role="alert" className="mt-3 text-center text-[12px] text-danger">{p.analyzeError}</p> : null;
  return (
    <div role="status" className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[12px] text-text-3">
      <span className="max-w-[220px] truncate text-text-2">{p.fileName}</span>
      <span className="text-text-4">·</span>
      {p.analyzeError ? (
        <span className="flex items-center gap-2 text-danger">
          {p.analyzeError}
          {p.videoId && <button className="text-text-1 underline-offset-2 hover:underline" onClick={() => void actions.retryAnalyze()}>
            Retry
          </button>}
        </span>
      ) : p.analyzing || !p.analysis ? (
        <Shimmer>Transcribing, finding scenes and beats…</Shimmer>
      ) : (
        <span className="tabular font-mono">
          {p.analysis.durationSec.toFixed(1)}s · {p.analysis.words.length} words · {p.analysis.scenes.length} scenes
        </span>
      )}
      <button aria-label="Remove clip" onClick={() => actions.clearUpload()} className="grid size-5 place-items-center rounded-full text-text-3 hover:text-text-1">
        <IconX size={12} />
      </button>
    </div>
  );
}

function Inspiration() {
  const p = useStore((s) => s.project);
  const input = useRef<HTMLInputElement>(null);
  const file = p.referenceUrl.startsWith("upload:");
  return (
    <details className="mt-4 rounded-[14px] bg-surface-1 px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--hairline)]" open={p.referenceUrl || p.referenceNotice ? true : undefined}>
      <summary className="cursor-pointer text-[12px] text-text-2">Copy an inspiration video <span className="text-text-4">· optional</span></summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {file ? <span className="min-w-0 flex-1 truncate text-[12px] text-text-1">{p.referenceUrl.slice(7)}</span> : <input type="url" aria-label="Inspiration video link" placeholder="Paste a video link…" value={p.referenceUrl} onChange={(e) => actions.setReferenceUrl(e.target.value)} className="h-9 min-w-[160px] flex-1 rounded-[10px] bg-surface-2 px-3 text-[13px] outline-none placeholder:text-text-4" />}
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()}><IconUpload size={13} /> Attach video</Button>
        {p.referenceUrl && <Button size="icon-sm" variant="ghost" aria-label="Remove inspiration" onClick={() => actions.setReferenceFile(null)}><IconX size={13} /></Button>}
        <input ref={input} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) actions.setReferenceFile(f); e.target.value = ""; }} />
      </div>
      {p.referenceNotice && <p role="status" className="mt-2 text-[12px] text-text-3">{p.referenceNotice}</p>}
      <p className="mt-2 text-[11px] text-text-3">Use a link, or attach the video if the link cannot be opened.</p>
    </details>
  );
}

/** 9:16 drop zone tile (also a file picker). */
function DropTile({ onAttach }: { onAttach: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const fileName = useStore((s) => s.project.fileName);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f?.type.startsWith("video/")) onAttach(f);
  };
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      className={`group flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed text-center transition-colors ${
        drag ? "border-text-2 bg-surface-2" : "border-[var(--hairline-strong)] bg-surface-1/40 hover:bg-surface-1"
      }`}
    >
      <span className="grid size-9 place-items-center rounded-full bg-surface-2 text-text-2 shadow-[inset_0_0_0_1px_var(--hairline)] group-hover:text-text-1">
        <IconUpload />
      </span>
      <span className="text-[13px] font-medium text-text-1">{fileName ? "Replace clip" : "Drop a clip"}</span>
      <span className="px-4 text-[11px] leading-[14px] text-text-3">Vertical or wide, up to 3 min</span>
      <input
        ref={input}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onAttach(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}

function RecentCard({ id, entry, i }: { id: string; entry: PlanEntry; i: number }) {
  const p = entry.base;
  const frames = useStore((s) => s.analyses[p.source.videoId]?.frames ?? (s.project.analysis?.videoId === p.source.videoId ? s.project.analysis.frames : undefined));
  const poster = posterFor(p.clips[0]?.srcStart ?? 0, frames ?? sampleAnalysis.frames);
  return (
    <Link href={`/app/edit/${id}`} className="uf-rise block rounded-[14px]" style={{ ["--i" as string]: i + 1 }}>
      <VideoCard src={p.source.src} poster={poster} title={entry.name} meta={`${p.durationSec.toFixed(1)}s`} play="hover" />
    </Link>
  );
}

function SampleTile({ onStart, disabled }: { onStart: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onStart} className="group relative block text-left disabled:opacity-40">
      <VideoCard src="/demo/sample.mp4" poster="/demo/frame-12.jpg" title="Try the sample clip" meta="20s" play="hover" />
      <span className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
        <IconArrowRight size={14} />
      </span>
    </button>
  );
}

export function posterFor(t: number, frames: { t: number; url: string }[]) {
  return frames.reduce((b, f) => (Math.abs(f.t - t) < Math.abs(b.t - t) ? f : b), frames[0])?.url;
}
