"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { actions, useStore } from "@/lib/client/store";
import type { StyleChoice } from "@/lib/client/types";
import { AppHeader } from "../AppHeader";
import { Button, Chip, Icon, STYLE_META, cx } from "../ui";
import { StyleModal } from "./StyleModal";

const PRESETS = ["gaming-montage", "podcast-clip", "storytime", "chaos"] as const;
const IDEAS = ["Make it a 15s vertical cut with a cold open", "Meme sounds on every fail", "Clean captions for a podcast clip"];

export function HomeScreen() {
  const router = useRouter();
  const project = useStore((s) => s.project);
  const runStatus = useStore((s) => s.run.status);
  const hasVariants = useStore((s) => s.run.slots.some(Boolean));
  const [modal, setModal] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("video/")) return;
    await actions.upload(file); // analysis keeps running; Generate waits for it

  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    void onFile(e.dataTransfer.files[0]);
  }
  function start(style: StyleChoice) {
    actions.setStyle(style);
    setModal(false);
    void actions.generate(9);
    router.push("/app/variants");
  }

  const ready = !project.analyzeError;
  const presetSel = project.style?.kind === "preset" ? project.style.preset : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader>
        {hasVariants && runStatus !== "generating" && (
          <button onClick={() => router.push("/app/variants")} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-ink-muted hover:bg-surface-2 hover:text-ink">
            <Icon name="grid" className="size-4" /> Last 9 edits
          </button>
        )}
      </AppHeader>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-16 pt-10 sm:px-6 sm:pt-20">
        <h1 className="text-center font-display text-[34px] font-extrabold leading-[38px] tracking-[-0.025em] sm:text-[48px] sm:leading-[52px]">
          What should this clip become?
        </h1>
        <p className="mx-auto mt-3 max-w-md text-center text-[15px] leading-6 text-ink-muted">
          Drop in raw footage. Unfold writes nine edits with captions, beat-synced music and meme sounds, in seconds.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cx(
            "mt-8 rounded-xl border bg-surface p-3 shadow-float transition-colors duration-[120ms] sm:p-4",
            drag ? "border-flare ring-4 ring-flare/15" : "border-border",
          )}
        >
          {/* Upload zone */}
          {project.fileName ? (
            <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-2.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-track-video text-white">
                <Icon name="film" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{project.fileName}</div>
                <div className="font-mono text-[12px] text-ink-muted tabular">
                  {project.analyzeError ? (
                    <span className="text-danger">{project.analyzeError}</span>
                  ) : project.analyzing || !project.analysis ? (
                    <span className="animate-pulse">Transcribing, finding scenes and beats… (10–30s, you can hit Generate)</span>
                  ) : (
                    `${project.analysis.durationSec.toFixed(1)}s · ${project.analysis.words.length} words · ${project.analysis.scenes.length} scenes`
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => actions.clearUpload()} aria-label="Remove clip">
                <Icon name="close" className="size-4" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-2/60 px-4 py-7 text-center transition-colors duration-[120ms] hover:border-ink-muted"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-surface text-flare shadow-float">
                <Icon name="upload" />
              </span>
              <span className="text-[15px] font-medium">Drop a raw clip, or browse</span>
              <span className="text-[13px] text-ink-muted">MP4 or MOV, up to 3 min. No clip? We&apos;ll use the sample gameplay clip.</span>
            </button>
          )}
          <input ref={fileInput} type="file" accept="video/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />

          {/* Prompt */}
          <textarea
            value={project.prompt}
            onChange={(e) => actions.setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) setModal(true);
            }}
            rows={3}
            placeholder="Describe the edit: “hype gaming montage, cold open on the plane, meme sounds on the fails”"
            className="mt-3 w-full resize-none rounded-md bg-transparent px-1.5 py-1 text-[16px] leading-6 outline-none placeholder:text-ink-muted"
          />

          {/* Inspiration + generate */}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 pl-3 focus-within:border-flare">
              <Icon name="link" className="size-4 shrink-0 text-violet" />
              <input
                value={project.referenceUrl}
                onChange={(e) => actions.setReferenceUrl(e.target.value)}
                placeholder="Paste inspiration link"
                className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-muted"
              />
              <button
                type="button"
                onClick={() => refInput.current?.click()}
                className="mr-1 shrink-0 rounded-sm px-2 py-1 text-[12px] text-ink-muted hover:bg-surface hover:text-ink"
              >
                or upload a reference
              </button>
              <input
                ref={refInput}
                type="file"
                accept="video/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) actions.setReferenceFile(f);
                }}
              />
            </div>
            <Button variant="primary" size="lg" disabled={!ready} onClick={() => setModal(true)} className="sm:w-auto">
              <Icon name="sparkle" className="size-4" /> Generate 9 edits
            </Button>
          </div>
        </div>

        {/* Preset chips */}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {PRESETS.map((p) => (
            <Chip key={p} selected={presetSel === p} onClick={() => actions.setStyle(presetSel === p ? null : { kind: "preset", preset: p })}>
              <span className="flex gap-0.5">
                {STYLE_META[p].swatch.slice(0, 2).map((c) => (
                  <span key={c} className="size-2.5 rounded-full border border-black/10" style={{ background: c }} />
                ))}
              </span>
              {STYLE_META[p].label}
            </Chip>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center gap-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.02em] text-ink-muted">Try</div>
          <div className="flex flex-wrap justify-center gap-2">
            {IDEAS.map((i) => (
              <button key={i} onClick={() => actions.setPrompt(i)} className="rounded-full border border-border px-3 py-1.5 text-[13px] text-ink-muted hover:border-ink-muted hover:text-ink">
                {i}
              </button>
            ))}
          </div>
        </div>
      </main>

      <StyleModal
        open={modal}
        onClose={() => setModal(false)}
        onPick={start}
        initial={project.style ?? (project.referenceUrl && !project.referenceUrl.startsWith("upload:") ? { kind: "link", url: project.referenceUrl } : null)}
        referenceUrl={project.referenceUrl}
      />
    </div>
  );
}
