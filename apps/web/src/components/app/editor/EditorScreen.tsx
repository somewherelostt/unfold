"use client";
import { sampleAnalysis } from "@unfold/core";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { exportVideo } from "@/lib/client/api";
import { actions, usePlan, useStore } from "@/lib/client/store";
import { PlanPlayer, type PlayerRef } from "../preview/PlanPlayer";
import { Timeline } from "../timeline/Timeline";
import { Button, Icon, Logo, cx, fmtTime } from "../ui";
import { ChatPanel } from "./ChatPanel";
import { DecisionsPanel, SECTIONS, type SectionKey } from "./DecisionsPanel";

const SPEEDS = [1, 1.5, 2, 0.5];
const BACKGROUNDS = [
  { label: "Dark", cls: "bg-[#0c0c0e]" },
  { label: "Light", cls: "bg-surface-2" },
  { label: "Brand", cls: "[background:var(--gradient-brand)]" },
];

export function EditorScreen() {
  const { id } = useParams<{ id: string }>();
  const { entry, plan } = usePlan(id);
  const library = useStore((s) => s.library);
  const frames = useStore((s) => s.project.analysis?.frames) ?? sampleAnalysis.frames;
  const playerRef = useRef<PlayerRef>(null);
  const [active, setActive] = useState<SectionKey>("captions");
  const [manual, setManual] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [bgIdx, setBgIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [platform, setPlatform] = useState("9:16 vertical");
  const [exporting, setExporting] = useState<null | { progress: number } | { url: string; note?: string } | { error: string }>(null);

  useEffect(() => {
    void actions.ensurePlan(id);
    void actions.loadLibrary();
  }, [id]);

  // Player play state for the toolbar.
  useEffect(() => {
    let p: PlayerRef | null = null;
    let raf = 0;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    const attach = () => {
      p = playerRef.current;
      if (!p) return void (raf = requestAnimationFrame(attach));
      p.addEventListener("play", on);
      p.addEventListener("pause", off);
      p.addEventListener("ended", off);
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      p?.removeEventListener("play", on);
      p?.removeEventListener("pause", off);
      p?.removeEventListener("ended", off);
    };
  }, [plan?.id, plan?.aspect]);

  // Keyboard: space play/pause, ⌘Z / ⇧⌘Z undo/redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) actions.redo(id);
        else actions.undo(id);
      } else if (e.key === " ") {
        e.preventDefault();
        playerRef.current?.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id]);

  async function doExport() {
    if (!entry || (exporting && "progress" in exporting)) return;
    setExporting({ progress: 0 });
    const note = Object.keys(entry.overrides).length ? "Rendered the agent's version; manual tweaks aren't in the export yet." : undefined;
    try {
      for await (const ev of exportVideo(entry.serverId)) {
        if (ev.type === "progress") setExporting({ progress: ev.progress });
        else if (ev.type === "ready") setExporting({ url: ev.url, note });
        else if (ev.type === "error") throw new Error(ev.message);
      }
    } catch (e) {
      setExporting({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  const rendering = !!exporting && "progress" in exporting;

  if (!entry || !plan) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="animate-pulse text-[14px] text-ink-muted">Loading edit…</span>
      </div>
    );
  }

  const jump = (k: SectionKey) => {
    setActive(k);
    document.getElementById(`sec-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg max-lg:h-auto max-lg:min-h-dvh max-lg:overflow-visible">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <Logo wordmark={false} />
        <Link href="/app/variants" className="hidden items-center gap-1 rounded-md px-2 py-1 text-[13px] text-ink-muted hover:bg-surface-2 hover:text-ink sm:flex">
          <Icon name="grid" className="size-4" /> 9 edits
        </Link>
        <span className="hidden text-border sm:inline">/</span>
        <input
          value={entry.name}
          onChange={(e) => actions.rename(id, e.target.value)}
          aria-label="Project name"
          className="h-8 min-w-0 max-w-[260px] flex-1 rounded-sm bg-transparent px-2 text-[14px] font-medium outline-none hover:bg-surface-2 focus:bg-surface-2"
        />
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Undo" title="Undo (⌘Z)" disabled={!entry.past.length} onClick={() => actions.undo(id)}>
            <Icon name="undo" className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!entry.future.length} onClick={() => actions.redo(id)}>
            <Icon name="redo" className="size-4" />
          </Button>
          <Button size="sm" onClick={() => setManual((m) => !m)} className={cx("ml-1 hidden sm:inline-flex", manual && "border-flare text-flare")}>
            <Icon name="edit" className="size-4" /> {manual ? "Editing manually" : "Edit manually"}
          </Button>
          <Button variant="primary" size="sm" className="ml-1" onClick={() => void doExport()} disabled={rendering}>
            <Icon name="export" className="size-4" />{" "}
            {rendering ? <span className="font-mono tabular">Rendering {Math.round((exporting as { progress: number }).progress * 100)}%</span> : "Export"}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[64px_300px_minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)_auto]">
        {/* Icon rail */}
        <nav className="hidden border-r border-border bg-surface py-2 lg:row-span-2 lg:flex lg:flex-col lg:items-center lg:gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => jump(s.key)}
              className={cx(
                "flex w-14 flex-col items-center gap-1 rounded-md py-2 text-[10px] transition-colors duration-[120ms]",
                active === s.key ? "bg-surface-2 text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon name={s.icon} />
              {s.label}
            </button>
          ))}
        </nav>

        {/* Decisions panel */}
        <aside className="order-3 min-h-0 overflow-y-auto border-border bg-surface lg:order-none lg:border-r">
          <DecisionsPanel
            id={id}
            plan={plan}
            base={entry.base}
            overrides={entry.overrides}
            library={library}
            playerRef={playerRef}
            manual={manual}
            onExport={() => void doExport()}
            platform={platform}
            setPlatform={setPlatform}
          />
        </aside>

        {/* Stage */}
        <section className={cx("relative order-1 flex min-h-[60dvh] items-center justify-center p-6 pb-16 transition-colors lg:order-none lg:min-h-0", BACKGROUNDS[bgIdx].cls)}>
          <div className="relative flex h-full max-h-[calc(100dvh-14rem)] w-full items-center justify-center max-lg:h-[56dvh]">
            <div className="relative overflow-hidden rounded-xl shadow-float" style={{ aspectRatio: `${plan.width} / ${plan.height}`, height: "100%", maxWidth: "100%" }}>
              <PlanPlayer ref={playerRef} plan={plan} playbackRate={SPEEDS[speedIdx]} />
              <button className="absolute inset-0" aria-label={playing ? "Pause" : "Play"} onClick={() => playerRef.current?.toggle()} />
            </div>
          </div>
          {/* floating pill toolbar */}
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface/95 p-1 text-[12px] shadow-float backdrop-blur">
            <button onClick={() => playerRef.current?.toggle()} className="flex size-8 items-center justify-center rounded-full bg-ink text-bg" aria-label={playing ? "Pause" : "Play"}>
              <Icon name={playing ? "pause" : "play"} className="size-3.5" />
            </button>
            <Pill onClick={() => actions.override(id, { aspect: plan.aspect === "9:16" ? "1:1" : plan.aspect === "1:1" ? "16:9" : "9:16" })}>{plan.aspect}</Pill>
            <Pill onClick={() => setBgIdx((i) => (i + 1) % BACKGROUNDS.length)}>
              <span className={cx("size-3 rounded-full border border-border", BACKGROUNDS[bgIdx].cls)} /> {BACKGROUNDS[bgIdx].label}
            </Pill>
            <Pill onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>
              <span className="font-mono tabular">{SPEEDS[speedIdx]}×</span>
            </Pill>
            <span className="px-2 font-mono text-ink-muted tabular">{fmtTime(plan.durationSec)}</span>
          </div>
        </section>

        {/* Chat */}
        <aside className="order-4 min-h-[420px] border-border bg-surface lg:order-none lg:row-span-2 lg:min-h-0 lg:border-l">
          <ChatPanel id={id} plan={plan} chat={entry.chat} manual={manual} onResume={() => setManual(false)} />
        </aside>

        {/* Timeline */}
        <div className="order-2 overflow-x-auto border-t border-border bg-surface px-3 pb-3 pt-2 lg:order-none lg:col-span-2 lg:col-start-2">
          <div className="min-w-[640px]">
            <Timeline plan={plan} frames={frames} playerRef={playerRef} />
          </div>
        </div>
      </div>

      {exporting && !rendering && (
        <div className="fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-[14px] shadow-float">
          <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", "url" in exporting ? "bg-success" : "bg-danger")} />
          <div className="min-w-0 flex-1">
            {"url" in exporting ? (
              <>
                Export ready{" "}
                <a href={exporting.url} download className="font-medium text-flare underline-offset-4 hover:underline">
                  Download MP4
                </a>
                {exporting.note && <p className="mt-1 text-[12px] text-ink-muted">{exporting.note}</p>}
              </>
            ) : (
              <>
                Export failed
                <p className="mt-1 break-words text-[12px] text-ink-muted">{exporting.error}</p>
              </>
            )}
          </div>
          <button onClick={() => setExporting(null)} aria-label="Dismiss" className="text-ink-muted hover:text-ink">
            <Icon name="close" className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function Pill({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-ink hover:bg-surface-2">
      {children}
    </button>
  );
}
