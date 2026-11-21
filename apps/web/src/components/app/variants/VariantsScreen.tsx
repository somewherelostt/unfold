"use client";
import type { EditPlan } from "@unfold/core";
import { sampleAnalysis } from "@unfold/core";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { actions, useStore, type State } from "@/lib/client/store";
import { AppHeader } from "../AppHeader";
import { PlanPlayer } from "../preview/PlanPlayer";
import { Timeline } from "../timeline/Timeline";
import { Button, Icon, SpeedBadge, cx, fmtNum, sfxEmoji } from "../ui";
import { VariantCard } from "./VariantCard";

const TRACK_STEP_MS = 230;
const TRACKS = 6;

function runStats(run: State["run"], all: State["plans"]) {
  const stats = run.slots.flatMap((id) => (id && all[id]?.stats ? [all[id].stats!] : []));
  const count = run.slots.filter(Boolean).length;
  const tokens = run.summary?.outputTokens ?? stats.reduce((a, s) => a + s.outputTokens, 0);
  const tpsAvg = run.summary?.avgTps ?? (stats.length ? stats.reduce((a, s) => a + s.tps, 0) / stats.length : 0);
  // Plans write in parallel: the slowest generation is how long "all 9" took once Cerebras picked them up.
  const genMs = stats.reduce((a, s) => Math.max(a, s.genMs), 0);
  const queueMs = stats.length ? Math.min(...stats.map((s) => s.queueMs ?? 0)) : 0;
  return { count, tokens, tpsAvg, genMs, queueMs };
}

export function VariantsScreen() {
  const startedAt = useStore((s) => s.run.startedAt);
  // Remount per run so a regenerate replays the generating view and the reveal.
  return <Variants key={startedAt} />;
}

function Variants() {
  const run = useStore((s) => s.run);
  const plans = useStore((s) => s.plans);
  const project = useStore((s) => s.project);
  const frames = project.analysis?.frames ?? sampleAnalysis.frames;
  const stats = runStats(run, plans);

  // Phase: generating view until the run is done and the track reveal has played out.
  const finished = run.status === "done" || (run.status === "error" && run.slots.some(Boolean));
  const [revealDone, setRevealDone] = useState(finished);
  const [reveal, setReveal] = useState(finished ? TRACKS : 0);
  const firstId = run.slots.find(Boolean) ?? null;
  const firstPlan = firstId ? plans[firstId]?.base : undefined;

  useEffect(() => {
    if (revealDone || !firstPlan) return;
    const iv = setInterval(() => setReveal((r) => Math.min(TRACKS, r + 1)), TRACK_STEP_MS);
    return () => clearInterval(iv);
  }, [revealDone, firstPlan]);
  useEffect(() => {
    if (revealDone || reveal < TRACKS || !finished) return;
    const t = setTimeout(() => setRevealDone(true), 450);
    return () => clearTimeout(t);
  }, [reveal, finished, revealDone]);

  if (run.status === "idle" && !run.slots.some(Boolean)) {
    return (
      <Shell>
        <div className="mx-auto flex max-w-sm flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="font-display text-[32px] font-bold leading-[38px] tracking-[-0.015em]">No edits yet</h1>
          <p className="text-[15px] text-ink-muted">Drop in a clip and Unfold writes nine edits of it.</p>
          <Link href="/app">
            <Button variant="primary">Unfold a clip</Button>
          </Link>
        </div>
      </Shell>
    );
  }

  if (run.status === "error" && !firstPlan) {
    return (
      <Shell>
        <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="font-display text-[32px] font-bold leading-[38px]">That run failed</h1>
          <p className="break-words font-mono text-[12px] text-danger">{run.error}</p>
          <Button variant="primary" onClick={() => void actions.generate(9)}>
            Try again
          </Button>
        </div>
      </Shell>
    );
  }

  if (!revealDone) return <GeneratingView plan={firstPlan} reveal={reveal} run={run} plans={plans} />;

  return (
    <Shell>
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6 sm:pt-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-[13px] text-flare tabular">
              {stats.count} edits · {fmtNum(stats.tokens)} tokens
              {stats.queueMs > 1000 && <span className="text-ink-muted"> · {(stats.queueMs / 1000).toFixed(0)}s queued at Cerebras</span>}
            </div>
            <h1 className="mt-1 font-display text-[32px] font-bold leading-[38px] tracking-[-0.015em] sm:text-[40px] sm:leading-[44px]">Pick an edit to keep working on</h1>
            <p className="mt-1 text-[15px] text-ink-muted">
              {project.prompt ? `“${project.prompt}”` : "Hover to preview, click to edit. Each one is a different hook, cut, track and caption style."}
            </p>
            {run.warning && <p className="mt-1 text-[13px] text-danger">{run.warning}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stats.tpsAvg > 0 && <SpeedBadge ms={stats.genMs} tps={stats.tpsAvg} label={`all ${stats.count} in`} />}
            <Button size="sm" onClick={() => void actions.generate(9)}>
              Regenerate
            </Button>
          </div>
        </div>

        <UnfoldGrid>
          {run.slots.map((id, i) =>
            id && plans[id] ? (
              <VariantCard key={id} plan={plans[id].base} stats={plans[id].stats} index={i} frames={frames} />
            ) : run.slotErrors[i] ? (
              <div key={`e${i}`} title={run.slotErrors[i] ?? ""} className="flex aspect-[9/16] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border p-4 text-center">
                <span className="text-[14px] font-medium">Edit {i + 1} didn&apos;t land</span>
                <span className="line-clamp-3 text-[12px] text-ink-muted">{run.slotErrors[i]}</span>
              </div>
            ) : (
              <div key={`s${i}`} className="aspect-[9/16] animate-pulse rounded-xl bg-surface-2" />
            ),
          )}
        </UnfoldGrid>
      </main>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader>
        <Link href="/app" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-ink-muted hover:bg-surface-2 hover:text-ink">
          <Icon name="upload" className="size-4" /> New clip
        </Link>
      </AppHeader>
      {children}
    </div>
  );
}

/** Cards fan out from the top-left card, 40ms stagger (brand "unfold" reveal). */
function UnfoldGrid({ children }: { children: React.ReactNode }) {
  const grid = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cards = [...el.children] as HTMLElement[];
    const origin = cards[0]?.getBoundingClientRect();
    if (!origin) return;
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const dx = origin.left - r.left;
      const dy = origin.top - r.top;
      c.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) rotate(${-4 - i * 1.5}deg) scale(.92)`, opacity: i === 0 ? 1 : 0.4 },
          { transform: "translate(0,0) rotate(0) scale(1)", opacity: 1 },
        ],
        { duration: 560, delay: i * 40, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
      );
    });
  }, []);
  return (
    <div ref={grid} className="relative mx-auto mt-8 grid max-w-[880px] grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-5 md:grid-cols-3 lg:gap-x-8">
      {children}
    </div>
  );
}

function useElapsed(startedAt: number, doneAt?: number) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    if (doneAt) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [doneAt]);
  return Math.max(0, (doneAt ?? now) - startedAt);
}

function decisions(plan: EditPlan): { track: number; text: string }[] {
  const sfx = plan.sfx.map((s) => sfxEmoji(s.sfxId)).join(" ");
  return [
    { track: 0, text: plan.hookText ? `Hook: “${plan.hookText}” · ${plan.clips.length} clips, ${plan.durationSec.toFixed(1)}s` : `${plan.clips.length} clips, ${plan.durationSec.toFixed(1)}s` },
    { track: 1, text: `Captions: ${plan.captions.preset}, ${plan.captions.chunks.length} chunks` },
    { track: 2, text: plan.music ? `Music: ${plan.music.title} · ${plan.music.bpm} BPM, cuts on the beat` : "Music: none, voice carries it" },
    { track: 3, text: plan.sfx.length ? `${plan.sfx.length} meme sounds ${sfx}` : "No meme sounds" },
    { track: 4, text: plan.transitions.length ? `Transitions: ${plan.transitions.map((t) => t.type).join(", ")}` : "Straight cuts" },
    { track: 5, text: `${plan.zooms.length} zooms` },
  ];
}

function GeneratingView({ plan, reveal, run, plans }: { plan?: EditPlan; reveal: number; run: State["run"]; plans: State["plans"] }) {
  const { slots, slotErrors, status } = run;
  const elapsed = useElapsed(run.startedAt, run.doneAt);
  const queued = useElapsed(run.queuedAt ?? run.startedAt, run.firstAt ?? run.doneAt);
  const ready = slots.filter(Boolean).length;
  const failed = slotErrors.filter(Boolean).length;
  const firstStats = slots.map((id) => (id ? plans[id]?.stats : undefined)).find(Boolean);
  const title =
    status === "preparing" ? `${run.phase ?? "Getting ready"}…` : status === "queued" ? "Queued at Cerebras…" : run.doneAt ? "Edits ready" : "Writing your edits";
  return (
    <Shell>
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 pb-16 pt-8 sm:px-6 md:grid-cols-[minmax(0,300px)_1fr] md:gap-10 md:pt-12">
        <div className="mx-auto w-full max-w-[300px]">
          <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-black">
            {plan ? (
              <PlanPlayer plan={plan} muted autoPlay loop />
            ) : (
              <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-surface-2 to-border" />
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="relative flex size-2.5">
              <span className={cx("absolute inline-flex size-full animate-ping rounded-full opacity-60", status === "queued" ? "bg-flare" : "bg-violet")} />
              <span className={cx("relative inline-flex size-2.5 rounded-full", status === "queued" ? "bg-flare" : "bg-violet")} />
            </span>
            <h1 className="font-display text-[28px] font-bold leading-[32px] tracking-[-0.015em]">{title}</h1>
            <span className="font-mono text-[14px] text-ink-muted tabular">{((status === "queued" ? queued : elapsed) / 1000).toFixed(1)}s</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {firstStats && <SpeedBadge ms={firstStats.genMs} tps={firstStats.tps} />}
            <span className="text-[13px] text-ink-muted">Kimi K3.1 Pro on Cerebras · OpenClaw agent</span>
          </div>
          {status === "preparing" && run.phase?.startsWith("Watching") && (
            <p className="mt-4 max-w-lg text-[14px] leading-6 text-ink-muted">
              Downloading it, sampling frames and asking Kimi for its cut rate, caption style, zooms and sound. Your nine edits copy that style.
            </p>
          )}
          {status === "queued" && (
            <p className="mt-4 max-w-lg text-[14px] leading-6 text-ink-muted">
              Cerebras is busy with hackathon traffic, so your request is waiting for a slot. Once it starts, all {slots.length} edits write in about a
              second each, in parallel.
            </p>
          )}
          {run.warning && <p className="mt-2 text-[13px] text-danger">{run.warning}</p>}

          <ul className="mt-5 space-y-1.5 text-[14px]">
            {(plan ? decisions(plan) : []).map((d, i) => (
              <li
                key={i}
                className={cx("flex items-start gap-2 transition-[opacity,transform] duration-[240ms] ease-out", d.track < reveal ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")}
              >
                <span className="mt-0.5 text-violet">✓</span>
                <span className="min-w-0">{d.text}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 rounded-lg border border-border bg-surface p-3">
            {plan ? <Timeline plan={plan} reveal={reveal} compact /> : <div className="h-[214px] animate-pulse rounded-md bg-surface-2" />}
          </div>

          <div className="mt-6 flex items-center gap-4">
            <div className="grid grid-cols-9 gap-1">
              {slots.map((id, i) => (
                <span
                  key={i}
                  title={id ? plans[id]?.base.title : (slotErrors[i] ?? "planning…")}
                  className={cx("h-8 w-[18px] rounded-[4px] transition-colors duration-[240ms]", id ? "bg-flare" : slotErrors[i] ? "bg-danger/40" : "animate-pulse bg-surface-2")}
                />
              ))}
            </div>
            <span className="font-mono text-[13px] text-ink-muted tabular">
              {ready}/{slots.length} edits{failed ? ` · ${failed} failed` : ""}
            </span>
          </div>
        </div>
      </main>
    </Shell>
  );
}
