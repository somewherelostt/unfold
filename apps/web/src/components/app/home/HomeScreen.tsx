"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { actions, useStore } from "@/lib/client/store";
import type { StyleChoice } from "@/lib/client/types";
import { AppHeader, HeaderLink } from "../AppHeader";
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
          <HeaderLink onClick={() => router.push("/app/variants")} icon="grid">
            Last edits
          </HeaderLink>
        )}
      </AppHeader>

      <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col px-4 pb-20 pt-12 sm:px-6 sm:pt-24">
        <h1 className="t-display blur-in text-balance text-center">What should this clip become?</h1>
        <p className="t-h3 fg-2 blur-in mx-auto mt-3 max-w-md text-balance text-center font-normal [animation-delay:150ms]">
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
            "layer-1 float mt-10 overflow-hidden rounded-[16px]",
            drag && "shadow-[inset_0_0_0_1px_var(--flare),0_0_0_4px_var(--flare-10)]",
          )}
        >
          {/* Clip */}
          <div className="p-2">
            {project.fileName ? (
              <div className="layer-2 flex items-center gap-3 rounded-[10px] p-2">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-track-video text-white">
                  <Icon name="film" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="t-body truncate font-medium">{project.fileName}</div>
                  <div className="t-meta">
                    {project.analyzeError ? (
                      <span className="text-danger">{project.analyzeError}</span>
                    ) : project.analyzing || !project.analysis ? (
                      <span className="shimmer">Transcribing, finding scenes and beats…</span>
                    ) : (
                      <span className="t-mono fg-3 font-normal">
                        {project.analysis.durationSec.toFixed(1)}s · {project.analysis.words.length} words · {project.analysis.scenes.length} scenes
                      </span>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => actions.clearUpload()} aria-label="Remove clip">
                  <Icon name="close" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="tint layer-2 flex w-full items-center gap-3 rounded-[10px] p-2 text-left"
              >
                <span className="layer-1 hair flex size-10 shrink-0 items-center justify-center rounded-[8px] text-flare">
                  <Icon name="upload" />
                </span>
                <span className="min-w-0">
                  <span className="t-body block font-medium">Drop a raw clip, or browse</span>
                  <span className="t-meta fg-3 block">MP4 or MOV, up to 3 min. No clip? We&apos;ll use the sample gameplay clip.</span>
                </span>
              </button>
            )}
            <input ref={fileInput} type="file" accept="video/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>

          {/* Prompt */}
          <textarea
            value={project.prompt}
            onChange={(e) => actions.setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) setModal(true);
            }}
            rows={3}
            placeholder="Describe the edit: hype montage, cold open on the best moment, meme sounds on the fails"
            className="block w-full resize-none bg-transparent px-4 py-2 text-[15px] leading-6 outline-none placeholder:text-[var(--fg-4)] focus-visible:shadow-none"
          />

          {/* Inspiration + generate */}
          <div className="hair-t flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
            <div className="layer-2 flex min-w-0 flex-1 items-center gap-2 rounded-[8px] pl-2.5">
              <Icon name="link" className="shrink-0 text-[var(--fg-3)]" />
              <input
                value={project.referenceUrl}
                onChange={(e) => actions.setReferenceUrl(e.target.value)}
                placeholder="Paste inspiration link"
                className="t-body h-9 min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--fg-4)] focus-visible:shadow-none"
              />
              <button type="button" onClick={() => refInput.current?.click()} className="tint t-meta fg-3 mr-1 shrink-0 rounded-[6px] px-2 py-1 hover:text-[var(--fg-1)]">
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
            <Button variant="primary" size="lg" disabled={!ready} onClick={() => setModal(true)}>
              <Icon name="sparkle" /> Generate 9 edits
              <kbd className="t-mono ml-1 hidden rounded-[4px] bg-black/15 px-1 text-[10px] sm:inline">⌘↵</kbd>
            </Button>
          </div>
        </div>

        {/* Preset chips */}
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {PRESETS.map((p) => (
            <Chip key={p} selected={presetSel === p} onClick={() => actions.setStyle(presetSel === p ? null : { kind: "preset", preset: p })}>
              <span className="flex -space-x-0.5">
                {STYLE_META[p].swatch.slice(0, 2).map((c) => (
                  <span key={c} className="size-2.5 rounded-full shadow-[inset_0_0_0_0.5px_rgb(0_0_0/.2)]" style={{ background: c }} />
                ))}
              </span>
              {STYLE_META[p].label}
            </Chip>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center gap-2">
          <div className="t-meta fg-4 uppercase tracking-[0.04em]">Try</div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {IDEAS.map((i) => (
              <button key={i} onClick={() => actions.setPrompt(i)} className="tint hair hair-hover t-label fg-3 rounded-full px-3 py-1.5 font-normal hover:text-[var(--fg-1)]">
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
