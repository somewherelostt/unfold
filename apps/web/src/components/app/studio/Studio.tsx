"use client";
/**
 * The editor shell, used for both the generating state (/app/new) and editing (/app/edit/[id]):
 * 48px top bar · 56px icon rail + floating 320px panel · centred preview with a floating pill toolbar ·
 * 360px agent chat · 220px timeline that stops at the chat · alternate versions drawer.
 */
import type { EditPlan } from "@unfold/core";
import { sampleAnalysis } from "@unfold/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { actions, isActive, usePlan, useStore, type PlanEntry, type Run } from "@/lib/client/store";
import { generationErrorTitle } from "@/lib/client/errors";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { MenuItem, Popover } from "@/components/ui/Popover";
import { Shimmer } from "@/components/ui/Shimmer";
import { SpeedBadge } from "@/components/ui/SpeedBadge";
import {
  IconBack,
  IconCaptions,
  IconChevronDown,
  IconExpand,
  IconGrid,
  IconMedia,
  IconMusic,
  IconPause,
  IconPlay,
  IconRedo,
  IconSpeaker,
  IconStyle,
  IconTransition,
  IconUndo,
  IconX,
  IconCheck,
} from "@/components/ui/icons";
import { PlanPlayer, type PlayerRef } from "../preview/PlanPlayer";
import { cx } from "../ui";
import { AlternatesDrawer } from "./AlternatesDrawer";
import { Chat } from "./Chat";
import { ExportButton } from "./ExportButton";
import { SaveButton } from "./SaveButton";
import { Timeline } from "./Timeline";
import { CaptionsPanel } from "./panels/CaptionsPanel";
import { MediaPanel } from "./panels/MediaPanel";
import { MusicPanel } from "./panels/MusicPanel";
import { SfxPanel } from "./panels/SfxPanel";
import { StylePanel } from "./panels/StylePanel";
import { TransitionsPanel } from "./panels/TransitionsPanel";
import { ReviewPanel } from "./panels/ReviewPanel";
import type { PanelProps } from "./panels/types";

const SECTIONS = [
  { key: "captions", label: "Captions", icon: IconCaptions, panel: CaptionsPanel },
  { key: "music", label: "Music", icon: IconMusic, panel: MusicPanel },
  { key: "sfx", label: "Sound FX", icon: IconSpeaker, panel: SfxPanel, title: "Sound effects" },
  { key: "transitions", label: "Transitions", icon: IconTransition, panel: TransitionsPanel },
  { key: "style", label: "Style", icon: IconStyle, panel: StylePanel },
  { key: "media", label: "Media", icon: IconMedia, panel: MediaPanel },
  { key: "review", label: "Review", icon: IconCheck, panel: ReviewPanel },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

// Layout (px)
const RAIL = 56;
const GAP = 8;
const PANEL_W = 320;
const TL_H = 264;
const DRAWER_H = 196;

/* ------------------------------------------------------------------ editing */

export function EditStudio({ id }: { id: string }) {
  const { entry, plan } = usePlan(id);
  const planError = useStore((s) => s.planErrors[id]);
  const access = useStore((s) => s.planAccess[id]);
  useEffect(() => {
    void actions.ensurePlan(id);
    void actions.loadLibrary();
  }, [id]);
  if (planError || access !== "ready" || !entry || !plan) {
    return (
      <Centered>
        {planError ? (
          <>
            <h1 className="font-display text-[32px] leading-[38px]">Couldn&apos;t open this edit</h1>
            <p className="text-[13px] text-danger">{planError}</p>
            <div className="flex gap-2">
              <Link href="/app" className={buttonClasses("secondary")}>
                Back
              </Link>
              <Button variant="primary" onClick={() => void actions.ensurePlan(id)}>
                Retry
              </Button>
            </div>
          </>
        ) : (
          <Shimmer>Opening your edit…</Shimmer>
        )}
      </Centered>
    );
  }
  return <Shell id={id} entry={entry} plan={plan} />;
}

/* ------------------------------------------------------------------ generating */

export function GenerateStudio() {
  const startedAt = useStore((s) => s.run.startedAt);
  return <Generating key={startedAt} />;
}

function Generating() {
  const router = useRouter();
  const run = useStore((s) => s.run);
  const id = run.slots[0] ?? null;
  const entry = useStore((s) => (id ? s.plans[id] : undefined));
  const plan = entry?.base;
  const [reveal, setReveal] = useState(0);

  useEffect(() => {
    void actions.loadLibrary();
  }, []);
  // Tracks fill one by one once the edit lands (video, captions, music, sfx, transitions).
  useEffect(() => {
    if (!plan) return;
    const iv = setInterval(() => setReveal((r) => Math.min(5, r + 1)), 420);
    return () => clearInterval(iv);
  }, [plan]);
  // Then the editor takes over (same layout, so nothing jumps).
  useEffect(() => {
    if (!id || reveal < 5 || run.status !== "done") return;
    const t = setTimeout(() => router.replace(`/app/edit/${id}`), 2200);
    return () => clearTimeout(t);
  }, [id, reveal, run.status, router]);

  if (run.status === "idle") {
    return (
      <Centered>
        <h1 className="font-display text-[32px] leading-[38px]">Nothing in progress</h1>
        <p className="text-[13px] text-text-2">Drop in a clip and Unfold edits it.</p>
        <Link href="/app" className={buttonClasses("primary")}>
          Start an edit
        </Link>
      </Centered>
    );
  }
  return <Shell generating run={run} id={id ?? undefined} entry={entry} plan={plan} reveal={reveal} />;
}

/* ------------------------------------------------------------------ shell */

function Shell({ id, entry, plan, generating, run, reveal = 5 }: { id?: string; entry?: PlanEntry; plan?: EditPlan; generating?: boolean; run?: Run; reveal?: number }) {
  const playerRef = useRef<PlayerRef>(null);
  const library = useStore((s) => s.library);
  const projectAspect = useStore((s) => s.project.aspect);
  const previewRatio = plan ? plan.width / plan.height : ({ "9:16": 9 / 16, "1:1": 1, "16:9": 16 / 9 }[projectAspect]);
  const frames =
    useStore((s) => {
      const vid = plan?.source.videoId ?? s.project.analysis?.videoId;
      return (vid && s.analyses[vid]?.frames) || (s.project.analysis && (!vid || s.project.analysis.videoId === vid) ? s.project.analysis.frames : undefined);
    }) ?? sampleAnalysis.frames;
  const hasAlts = useStore((s) => (id ? !!s.alts[s.altRoot[id] ?? id] : false));
  const [section, setSection] = useState<SectionKey | null>(null);
  const [selectedBrollId, selectBroll] = useState<string>();
  const [altChoice, setAltOpen] = useState<boolean | null>(null);
  const altOpen = !generating && (altChoice ?? hasAlts);
  const panelOpen = !generating && !!section;
  const ready = !generating && !!entry && !!plan;
  const showPlayer = !!plan && (!generating || (reveal >= 5 && run?.status === "done"));

  const openAlternates = () => {
    if (!id) return;
    setAltOpen(true);
    if (!hasAlts) void actions.generateAlternates(id, 3);
  };

  // Keyboard: space play/pause, ⌘Z / ⇧⌘Z
  useEffect(() => {
    if (!ready || !id) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.target as HTMLElement)?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) actions.redo(id);
        else actions.undo(id);
      } else if (e.key === " " && !(e.target as HTMLElement)?.closest("button, a, [role=slider]")) {
        e.preventDefault();
        playerRef.current?.toggle();
      } else if (e.key === "Escape") {
        setSection(null);
        setAltOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, id]);

  const stageLeft = RAIL + GAP + (panelOpen ? PANEL_W + GAP : 0);
  const stageBottom = TL_H + GAP * 2 + (altOpen ? DRAWER_H + GAP : 0);
  const panelProps: PanelProps | null =
    ready && id && entry && plan
      ? {
          id,
          plan,
          base: entry.base,
          overrides: entry.overrides,
          library,
          frames,
          playerRef,
          set: (o) => actions.override(id, o),
          seek: (t) => playerRef.current?.seekTo(Math.round(t * plan.fps)),
          now: () => (playerRef.current?.getCurrentFrame() ?? 0) / plan.fps,
          onAlternates: openAlternates,
          selectedBrollId,
        }
      : null;
  const active = SECTIONS.find((s) => s.key === section);

  return (
    <div
      className="relative flex min-h-dvh flex-col bg-bg xl:h-dvh xl:overflow-hidden"
      style={{ ["--stage-l" as string]: `${stageLeft}px`, ["--stage-b" as string]: `${stageBottom}px`, ["--preview-height" as string]: previewRatio >= 1 ? `calc((100vw - 32px) / ${previewRatio} + 100px)` : "68dvh" }}
    >
      <TopBar id={id} entry={entry} plan={plan} generating={generating} run={run} altOpen={altOpen} onAlternates={() => (altOpen ? setAltOpen(false) : openAlternates())} />

      {/* Rail */}
      <nav aria-label="Editing tools" className="chrome z-20 flex shrink-0 items-center gap-0.5 overflow-x-auto px-2 py-1 shadow-[inset_0_-1px_0_var(--hairline)] sm:gap-1 xl:absolute xl:bottom-0 xl:left-0 xl:top-12 xl:w-14 xl:flex-col xl:px-0 xl:pt-2 xl:shadow-none">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const on = section === s.key && panelOpen;
          return (
            <button
              key={s.key}
              type="button"
              disabled={!ready}
              aria-pressed={on}
              aria-controls={on ? "studio-panel" : undefined}
              onClick={() => setSection(on ? null : s.key)}
              className={cx(
                "flex w-11 shrink-0 flex-col items-center gap-1 rounded-[10px] py-2 text-[10px] leading-3 transition-colors disabled:opacity-35 sm:w-12",
                on ? "bg-surface-2 text-text-1 shadow-[inset_0_0_0_1px_var(--hairline-strong)]" : "text-text-3 hover:bg-surface-1 hover:text-text-1",
              )}
            >
              <Icon size={18} />
              {s.label}
            </button>
          );
        })}
      </nav>

      {/* Floating side panel */}
      {panelOpen && active && panelProps && (
        <Panel
          key={active.key}
          id="studio-panel"
          role="region"
          aria-label={"title" in active ? active.title : active.label}
          className="uf-panel-in z-20 m-2 flex max-h-[460px] min-h-0 flex-col overflow-hidden xl:absolute xl:left-16 xl:top-14 xl:m-0 xl:max-h-none xl:w-80 xl:[bottom:var(--stage-b)]"
        >
          <PanelHeader
            title={"title" in active ? active.title : active.label}
            actions={
              <Button size="icon-sm" variant="ghost" aria-label="Close panel" onClick={() => setSection(null)}>
                <IconX size={14} />
              </Button>
            }
          />
          <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
            <active.panel {...panelProps} />
          </div>
        </Panel>
      )}

      {/* Stage */}
      <section aria-label="Edit preview" className="relative z-10 flex h-[min(var(--preview-height),620px)] min-h-[320px] flex-col items-center justify-center px-4 pb-16 pt-4 transition-[left,bottom] duration-[var(--dur-panel)] ease-[var(--ease)] xl:absolute xl:right-[376px] xl:top-12 xl:h-auto xl:min-h-0 xl:pb-[68px] xl:pt-5 xl:[bottom:var(--stage-b)] xl:[left:var(--stage-l)]">
        <Stage plan={plan} ratio={previewRatio} frames={frames} playerRef={playerRef} showPlayer={showPlayer} generating={generating} run={run} />
        {plan && showPlayer && <PillToolbar id={id} plan={plan} playerRef={playerRef} editable={ready} />}
      </section>

      {/* Alternates drawer */}
      {altOpen && id && (
        <AlternatesDrawer
          id={id}
          frames={frames}
          onClose={() => setAltOpen(false)}
          className="z-20 m-2 h-[196px] shrink-0 xl:absolute xl:bottom-[280px] xl:left-16 xl:right-[376px] xl:m-0"
        />
      )}

      {/* Timeline */}
      <Panel aria-label="Edit timeline" className="z-20 m-2 h-[264px] shrink-0 overflow-x-auto overflow-y-hidden xl:absolute xl:bottom-2 xl:left-16 xl:right-[376px] xl:m-0">
        <div className="h-full min-w-[720px]">
          <Timeline plan={plan} frames={frames} reveal={generating ? Math.min(4, reveal) : 4} playerRef={showPlayer ? playerRef : undefined} onSelectBroll={(shotId) => { selectBroll(shotId); setSection("media"); }} />
        </div>
      </Panel>

      {/* Chat */}
      <Panel className="z-20 m-2 flex h-[500px] min-h-0 shrink-0 flex-col overflow-hidden xl:absolute xl:bottom-2 xl:right-2 xl:top-14 xl:m-0 xl:h-auto xl:w-[360px]">
        <Chat id={generating ? undefined : id} plan={plan} generating={generating} run={run} reveal={reveal} onAlternates={openAlternates} />
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-3 bg-bg px-4 text-center">{children}</div>;
}

function TopBar({ id, entry, plan, generating, run, altOpen, onAlternates }: { id?: string; entry?: PlanEntry; plan?: EditPlan; generating?: boolean; run?: Run; altOpen: boolean; onAlternates: () => void }) {
  const fileName = useStore((s) => s.project.fileName);
  const projectAspect = useStore((s) => s.project.aspect);
  const ready = !generating && !!id && !!entry;
  const name = entry?.name ?? (fileName ? fileName.replace(/\.[^.]+$/, "") : "Untitled edit");
  return (
    <header className="frosted chrome z-30 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-2 py-1 shadow-[inset_0_-1px_0_var(--hairline)] xl:absolute xl:inset-x-0 xl:top-0 xl:h-12 xl:grid-cols-[1fr_auto_1fr] xl:py-0">
      <div className="flex min-w-0 items-center gap-1">
        <Link href="/app" aria-label="Back" className={buttonClasses("ghost", "icon")}>
          <IconBack />
        </Link>
        {ready ? (
          <input
            value={name}
            onChange={(e) => actions.rename(id, e.target.value)}
            aria-label="Project name"
            className="h-8 min-w-0 max-w-[240px] flex-1 rounded-[8px] bg-transparent px-2 text-[13px] font-medium text-text-1 outline-none hover:bg-surface-2 focus:bg-surface-2"
          />
        ) : (
          <span className="truncate px-2 text-[13px] font-medium text-text-2">{name}</span>
        )}
      </div>

      <div className="order-3 col-span-2 flex items-center justify-center gap-1 pb-1 xl:order-none xl:col-span-1 xl:pb-0">
        <Popover
          align="center"
          className="w-40"
          trigger={({ toggle }) => (
            <button type="button" disabled={!ready} onClick={toggle} className="tabular flex h-8 items-center gap-1 rounded-full bg-surface-2 px-3 font-mono text-[12px] text-text-1 shadow-[inset_0_0_0_1px_var(--hairline)] disabled:opacity-40">
              {plan?.aspect ?? projectAspect}
              <IconChevronDown size={12} className="text-text-3" />
            </button>
          )}
        >
          {(close) =>
            (["9:16", "1:1", "16:9"] as const).map((a) => (
              <MenuItem
                key={a}
                selected={plan?.aspect === a}
                hint={a === "9:16" ? "vertical" : a === "1:1" ? "square" : "wide"}
                onClick={() => {
                  if (id) actions.override(id, { aspect: a });
                  close();
                }}
              >
                <span className="tabular font-mono">{a}</span>
              </MenuItem>
            ))
          }
        </Popover>
        <Button variant="ghost" size="sm" disabled={!ready} aria-pressed={altOpen} onClick={onAlternates} className={cx("h-8", altOpen && "text-text-1")}>
          <IconGrid size={14} /> Alternate versions
        </Button>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        {ready && id && entry && plan && <SaveButton id={id} entry={entry} plan={plan} />}
        {generating && run && isActive(run) && (
          <Button variant="ghost" size="sm" className="h-8" onClick={() => actions.cancel("main")}>
            Cancel
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label="Undo" title="Undo (⌘Z)" disabled={!ready || !entry?.past.length} onClick={() => id && actions.undo(id)}>
          <IconUndo />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!ready || !entry?.future.length} onClick={() => id && actions.redo(id)}>
          <IconRedo />
        </Button>
        {entry?.stats && (
          <span className="hidden px-1.5 xl:inline-flex">
            <SpeedBadge seconds={entry.stats.genMs / 1000} tps={entry.stats.tps} model={false} />
          </span>
        )}
        <ExportButton key={id ?? "generating"} id={id} serverId={ready ? entry?.serverId : undefined} plan={plan} disabled={!ready} />
      </div>
    </header>
  );
}

function Stage({ plan, ratio, frames, playerRef, showPlayer, generating, run }: { plan?: EditPlan; ratio: number; frames: { t: number; url: string }[]; playerRef: React.RefObject<PlayerRef | null>; showPlayer: boolean; generating?: boolean; run?: Run }) {
  const failed = generating && run && (run.status === "error" || run.status === "cancelled") && !plan;
  return (
    <div className="relative flex h-full w-full items-center justify-center" style={{ containerType: "size" }}>
      <div className="relative overflow-hidden rounded-[14px] bg-black shadow-[0_0_0_1px_var(--hairline),0_24px_64px_-16px_rgb(0_0_0/.7)]" style={{ width: `min(100cqw, calc(100cqh * ${ratio}))`, height: `min(100cqh, calc(100cqw / ${ratio}))` }}>
        {showPlayer && plan ? (
          <>
            <PlanPlayer ref={playerRef} plan={plan} muted={generating} autoPlay={generating} />
            <button type="button" className="absolute inset-0" aria-label="Play or pause" onClick={() => playerRef.current?.toggle()} />
          </>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {frames[0] && <img src={frames[Math.min(1, frames.length - 1)].url} alt="" className="uf-blur-frame absolute inset-0 size-full object-cover" />}
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              {failed ? (
                <div className="space-y-3">
                  <div className="font-display text-[24px] leading-[30px] text-white">{generationErrorTitle(run!)}</div>
                  {run!.error && <p className="text-[12px] text-white/70">{run!.error}</p>}
                  <div className="flex justify-center gap-2">
                    <Link href="/app" className={buttonClasses("secondary", "sm")}>
                      Back
                    </Link>
                    {run!.errorCode === "AUTH_REJECTED" ? <Link href="/settings" className={buttonClasses("primary", "sm")}>Open settings</Link> : run!.retryable !== false && !run!.interrupted && <Button size="sm" variant="primary" onClick={() => void actions.generate()}>
                      {run!.errorCode === "RATE_LIMITED" || run!.errorCode === "UNAVAILABLE" ? "Try again later" : "Try again"}
                    </Button>}
                  </div>
                </div>
              ) : (
                <span className="rounded-full bg-black/40 px-3 py-1 text-[12px] text-white/80 backdrop-blur">{plan ? "Assembling your edit…" : "Planning your edit…"}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PillToolbar({ id, plan, playerRef, editable }: { id?: string; plan: EditPlan; playerRef: React.RefObject<PlayerRef | null>; editable: boolean }) {
  const [playing, setPlaying] = useState(false);
  const time = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let p: PlayerRef | null = null;
    let raf = 0;
    const fmt = (f: number) => {
      const t = f / plan.fps;
      const m = Math.floor(t / 60);
      return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
    };
    const on = (e: { detail: { frame: number } }) => time.current && (time.current.textContent = fmt(e.detail.frame));
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    const attach = () => {
      p = playerRef.current;
      if (!p) return void (raf = requestAnimationFrame(attach));
      p.addEventListener("frameupdate", on);
      p.addEventListener("seeked", on);
      p.addEventListener("play", play);
      p.addEventListener("pause", pause);
      p.addEventListener("ended", pause);
      setPlaying(p.isPlaying());
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      p?.removeEventListener("frameupdate", on);
      p?.removeEventListener("seeked", on);
      p?.removeEventListener("play", play);
      p?.removeEventListener("pause", pause);
      p?.removeEventListener("ended", pause);
    };
  }, [playerRef, plan.fps]);
  const m = Math.floor(plan.durationSec / 60);
  const total = `${m}:${(plan.durationSec - m * 60).toFixed(1).padStart(4, "0")}`;
  return (
    <div className="frosted uf-toolbar-in chrome absolute bottom-3 left-1/2 flex max-w-[calc(100%-16px)] -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-full p-1 shadow-[var(--shadow-float)]">
      <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => playerRef.current?.toggle()} className="grid size-8 place-items-center rounded-full bg-primary-btn text-primary-btn-ink">
        {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
      </button>
      <span className="tabular px-2.5 font-mono text-[12px] text-text-3">
        <span ref={time} className="text-text-1">
          0:00.0
        </span>{" "}
        / {total}
      </span>
      <span className="mx-0.5 h-5 w-px bg-[var(--hairline-strong)]" />
      <button
        type="button"
        disabled={!editable}
        aria-label={plan.captions.enabled ? "Turn captions off" : "Turn captions on"}
        aria-pressed={plan.captions.enabled}
        onClick={() => id && actions.override(id, { captions: !plan.captions.enabled })}
        className={cx("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] transition-colors hover:bg-surface-3 disabled:opacity-40", plan.captions.enabled ? "text-text-1" : "text-text-3")}
      >
        <IconCaptions size={14} /> <span className="hidden sm:inline">{plan.captions.enabled ? "Captions on" : "Captions off"}</span>
      </button>
      <button type="button" aria-label="Fullscreen" onClick={() => playerRef.current?.requestFullscreen()} className="grid size-8 place-items-center rounded-full text-text-2 hover:bg-surface-3 hover:text-text-1">
        <IconExpand size={14} />
      </button>
    </div>
  );
}
