"use client";
import { sampleAnalysis } from "@unfold/core";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { exportVideo } from "@/lib/client/api";
import { actions, usePlan, useStore } from "@/lib/client/store";
import { PlanPlayer, type PlayerRef } from "../preview/PlanPlayer";
import { Timeline, type TrackKey } from "../timeline/Timeline";
import { Button, Icon, Logo, SpeedBadge, cx, fmtTime } from "../ui";
import { ChatPanel } from "./ChatPanel";
import { DecisionsPanel, SECTIONS, type SectionKey } from "./DecisionsPanel";

const SPEEDS = [1, 1.5, 2, 0.5];
const BACKGROUNDS = [
  { label: "Canvas", cls: "bg-[var(--layer-0)]" },
  { label: "Dark", cls: "bg-[#0a0a0a]" },
  { label: "Light", cls: "bg-[#f4f4f2]" },
  { label: "Brand", cls: "[background:var(--gradient-brand)]" },
];

export function EditorScreen() {
  const { id } = useParams<{ id: string }>();
  const { entry, plan } = usePlan(id);
  const library = useStore((s) => s.library);
  const frames =
    useStore((s) => {
      const vid = s.plans[id]?.base.source.videoId;
      return (vid && s.analyses[vid]?.frames) || (s.project.analysis?.videoId === vid ? s.project.analysis?.frames : undefined);
    }) ?? sampleAnalysis.frames;
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
        <span className="shimmer t-body">Loading edit…</span>
      </div>
    );
  }

  const jump = (k: SectionKey) => {
    setActive(k);
    document.getElementById(`sec-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const exportPct = rendering ? Math.round((exporting as { progress: number }).progress * 100) : 0;

  return (
    <div className="layer-0 relative flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      {/* Canvas backdrop (behind the floating chrome) */}
      <div className={cx("absolute inset-0 transition-colors duration-[var(--dur-3)]", BACKGROUNDS[bgIdx].cls)} />

      {/* Top bar: 40px glass */}
      <header className="glass hair-b chrome relative z-30 grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 lg:absolute lg:inset-x-0 lg:top-0">
        <div className="flex min-w-0 items-center gap-1">
          <Logo wordmark={false} />
          <Link href="/app/variants" className="tint fg-2 hidden h-7 items-center gap-1 rounded-[6px] px-2 hover:text-[var(--fg-1)] sm:flex">
            <Icon name="grid" /> Edits
          </Link>
          <span className="fg-4 hidden sm:inline">/</span>
          <input
            value={entry.name}
            onChange={(e) => actions.rename(id, e.target.value)}
            aria-label="Project name"
            className="tint h-7 min-w-0 max-w-[220px] flex-1 rounded-[6px] bg-transparent px-2 font-medium outline-none focus:bg-[var(--tint-hover)]"
          />
        </div>
        <div className="t-meta fg-3 hidden items-center gap-2 md:flex">
          {entry.stats && <SpeedBadge ms={entry.stats.genMs} tps={entry.stats.tps} label="" />}
        </div>
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" aria-label="Undo" title="Undo (⌘Z)" disabled={!entry.past.length} onClick={() => actions.undo(id)}>
            <Icon name="undo" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!entry.future.length} onClick={() => actions.redo(id)}>
            <Icon name="redo" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setManual((m) => !m)}
            className={cx("ml-1 hidden h-7 sm:inline-flex", manual && "text-flare")}
            aria-pressed={manual}
          >
            <Icon name="edit" /> {manual ? "Editing manually" : "Edit manually"}
          </Button>
          <Button variant="primary" size="sm" className="relative ml-1 h-7 overflow-hidden" onClick={() => void doExport()} disabled={rendering}>
            {rendering && <span className="absolute inset-y-0 left-0 bg-white/25 transition-[width] duration-[var(--dur-2)]" style={{ width: `${exportPct}%` }} />}
            <Icon name="export" />
            <span className="relative">{rendering ? <span className="t-mono">Rendering {exportPct}%</span> : "Export"}</span>
          </Button>
        </div>
      </header>

      {/* Left: rail + agent decisions, floating */}
      <aside className="panel float panel-in-left chrome relative z-20 order-3 m-2 flex min-h-0 overflow-hidden rounded-[12px] lg:absolute lg:bottom-[252px] lg:left-0 lg:top-12 lg:m-0 lg:ml-2 lg:w-[336px]">
        <nav className="hair-r hidden w-14 shrink-0 flex-col items-center gap-0.5 py-2 lg:flex" style={{ boxShadow: "inset -0.5px 0 0 var(--hair)" }}>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => jump(s.key)}
              data-active={active === s.key}
              className={cx("tint flex w-12 flex-col items-center gap-1 rounded-[8px] py-2 text-[10px] leading-3", active === s.key ? "fg-1" : "fg-3 hover:text-[var(--fg-1)]")}
            >
              <Icon name={s.icon} className="size-[18px]" />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="thin-scrollbar min-w-0 flex-1 overflow-y-auto">
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
        </div>
      </aside>

      {/* Stage: preview centred between the panels */}
      <section className="relative z-10 order-1 flex h-[64dvh] items-center justify-center px-4 pb-16 pt-4 lg:absolute lg:inset-x-[344px] lg:bottom-[252px] lg:top-10 lg:h-auto lg:pb-16 lg:pt-6 lg:[right:344px]">
        <div className="relative flex h-full w-full items-center justify-center">
          <div className="hair relative overflow-hidden rounded-[14px] shadow-[var(--shadow-high)]" style={{ aspectRatio: `${plan.width} / ${plan.height}`, height: "100%", maxWidth: "100%" }}>
            <PlanPlayer ref={playerRef} plan={plan} playbackRate={SPEEDS[speedIdx]} />
            <button className="absolute inset-0 cursor-pointer" aria-label={playing ? "Pause" : "Play"} onClick={() => playerRef.current?.toggle()} />
          </div>
        </div>
        {/* floating pill toolbar, springs in */}
        <div className="panel float-med spring-up chrome absolute bottom-3 left-1/2 flex items-center gap-0.5 rounded-full p-1">
          <button onClick={() => playerRef.current?.toggle()} className="tint flex size-8 items-center justify-center rounded-full bg-[var(--fg-1)] text-bg" aria-label={playing ? "Pause" : "Play"}>
            <Icon name={playing ? "pause" : "play"} className="size-3.5" />
          </button>
          <TimeReadout playerRef={playerRef} fps={plan.fps} duration={plan.durationSec} />
          <Sep />
          <Pill onClick={() => actions.override(id, { aspect: plan.aspect === "9:16" ? "1:1" : plan.aspect === "1:1" ? "16:9" : "9:16" })}>
            <span className="t-mono">{plan.aspect}</span>
          </Pill>
          <Pill onClick={() => setBgIdx((i) => (i + 1) % BACKGROUNDS.length)}>
            <span className={cx("size-3 rounded-full shadow-[inset_0_0_0_0.5px_var(--hair-strong)]", BACKGROUNDS[bgIdx].cls)} /> {BACKGROUNDS[bgIdx].label}
          </Pill>
          <Pill onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>
            <span className="t-mono">{SPEEDS[speedIdx]}×</span>
          </Pill>
        </div>
      </section>

      {/* Right: agent chat, floating */}
      <aside className="panel float panel-in-right relative z-20 order-4 m-2 h-[520px] overflow-hidden rounded-[12px] lg:absolute lg:bottom-2 lg:right-2 lg:top-12 lg:m-0 lg:h-auto lg:w-[328px]">
        <ChatPanel id={id} plan={plan} chat={entry.chat} manual={manual} onResume={() => setManual(false)} />
      </aside>

      {/* Bottom: timeline, floating */}
      <div className="panel float panel-in-up thin-scrollbar relative z-20 order-2 mx-2 overflow-x-auto rounded-[12px] px-3 pb-2.5 pt-1.5 lg:absolute lg:bottom-2 lg:left-0 lg:right-[344px] lg:m-0 lg:ml-2 lg:h-[236px]">
        <div className="min-w-[640px]">
          <Timeline plan={plan} frames={frames} playerRef={playerRef} selected={TRACKS_FOR[active]} />
        </div>
      </div>

      {exporting && !rendering && (
        <div className="panel float pop-in t-body fixed bottom-4 left-1/2 z-50 flex w-[min(380px,calc(100vw-32px))] -translate-x-1/2 items-start gap-3 rounded-[12px] px-4 py-3">
          <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", "url" in exporting ? "bg-success" : "bg-danger")} />
          <div className="min-w-0 flex-1">
            {"url" in exporting ? (
              <>
                Export ready{" · "}
                <a href={exporting.url} download className="font-medium text-flare underline-offset-4 hover:underline">
                  Download MP4
                </a>
                {exporting.note && <p className="t-meta fg-3 mt-1">{exporting.note}</p>}
              </>
            ) : (
              <>
                Export failed
                <p className="t-meta fg-3 mt-1 break-words">{exporting.error}</p>
              </>
            )}
          </div>
          <Button variant="ghost" size="icon" className="-mr-2 -mt-1 size-7" onClick={() => setExporting(null)} aria-label="Dismiss">
            <Icon name="close" />
          </Button>
        </div>
      )}
    </div>
  );
}

const TRACKS_FOR: Record<SectionKey, TrackKey[]> = {
  captions: ["captions"],
  music: ["music"],
  sfx: ["sfx"],
  transitions: ["transitions", "zooms"],
  style: ["video"],
  export: [],
};

function Sep() {
  return <span className="mx-1 h-5 w-px bg-[var(--hair-hover)]" />;
}

function Pill({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="tint fg-1 flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px]">
      {children}
    </button>
  );
}

/** Current time / duration, updated from player events without re-rendering the editor. */
function TimeReadout({ playerRef, fps, duration }: { playerRef: React.RefObject<PlayerRef | null>; fps: number; duration: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let p: PlayerRef | null = null;
    let raf = 0;
    const set = (f: number) => {
      if (el.current) el.current.textContent = fmtTime(f / fps);
    };
    const on = (e: { detail: { frame: number } }) => set(e.detail.frame);
    const attach = () => {
      p = playerRef.current;
      if (!p) return void (raf = requestAnimationFrame(attach));
      p.addEventListener("frameupdate", on);
      p.addEventListener("seeked", on);
      set(p.getCurrentFrame());
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      p?.removeEventListener("frameupdate", on);
      p?.removeEventListener("seeked", on);
    };
  }, [playerRef, fps]);
  return (
    <span className="t-mono fg-3 px-2 text-[12px] font-normal">
      <span ref={el} className="fg-1">
        0:00.0
      </span>{" "}
      / {fmtTime(duration)}
    </span>
  );
}
