"use client";
import { useRef, useState, type DragEvent } from "react";
import { actions, useStore } from "@/lib/client/store";
import { Button } from "@/components/ui/Button";
import { IconCheck, IconMedia, IconUpload, IconX } from "@/components/ui/icons";
import { Shimmer } from "@/components/ui/Shimmer";
import {UPLOAD_LIMIT_BYTES,UPLOAD_LIMIT_LABEL} from '@/lib/client/upload-limit';

export function SourceUpload({ onAttach, disabled }: { onAttach: (file: File | null) => void; disabled?: boolean }) {
  const project = useStore((s) => s.project);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [failedPoster, setFailedPoster] = useState("");
  const poster = project.analysis?.frames[0]?.url;
  function choose(file: File | undefined) {
    if (!file || disabled) return;
    if (!file.type.startsWith("video/")) return setError("Choose a video file for your main clip.");
    if (file.size>UPLOAD_LIMIT_BYTES) return setError(`Choose a video smaller than ${UPLOAD_LIMIT_LABEL}.`);
    setError("");
    onAttach(file);
  }
  function drop(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    choose(event.dataTransfer.files[0]);
  }
  return <div className="space-y-3">
    <input ref={input} type="file" accept="video/*" aria-label="Upload main clip" hidden disabled={disabled} onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} />
    {project.fileName ? <div className="uf-source-ready">
      <div className="uf-source-poster">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {poster && failedPoster !== poster ? <img src={poster} onError={() => setFailedPoster(poster)} alt="Your main clip" /> : <IconMedia size={28} />}
        <span className="uf-source-badge">Main clip · original audio</span>
      </div>
      <div className="flex min-w-0 items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-text-1" title={project.fileName}>{project.fileName}</p>
          <div role="status" className="mt-1 text-[12px] leading-5 text-text-3">
            {project.analyzing ? <Shimmer>Preparing your footage…</Shimmer> : project.analysis ? <span className="inline-flex items-center gap-1.5"><IconCheck size={13} className="text-success" />{project.analysis.durationSec.toFixed(1)}s · {project.analysis.words.length} words · {project.analysis.scenes.length} scenes</span> : "Waiting for analysis"}
          </div>
        </div>
        <Button size="icon" variant="ghost" aria-label={project.analyzing ? "Cancel upload and analysis" : "Remove main clip"} disabled={disabled} onClick={() => onAttach(null)}><IconX size={15} /></Button>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-hairline px-4 py-2">
        <span className="text-[12px] text-text-3">Your story starts here.</span>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => input.current?.click()}>Replace clip</Button>
      </div>
    </div> : <button type="button" disabled={disabled} className={`uf-upload-target ${dragging ? "is-dragging" : ""}`} onClick={() => input.current?.click()} onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <span className="uf-upload-icon"><IconUpload size={24} /></span>
      <span className="uf-upload-title">Upload your main clip</span>
      <span className="mt-1 text-[13px] leading-5 text-text-2">Drop a video here, or browse files</span>
      <span className="uf-upload-limits">Vertical or wide · up to 3 min · {UPLOAD_LIMIT_LABEL}</span>
    </button>}
    {(error || project.analyzeError) && <div role="alert" className="uf-status-card" data-tone="error"><p>{error || project.analyzeError}</p>{project.videoId && <Button size="sm" variant="secondary" disabled={project.analyzing} onClick={() => void actions.retryAnalyze()}>Retry analysis</Button>}</div>}
  </div>;
}
