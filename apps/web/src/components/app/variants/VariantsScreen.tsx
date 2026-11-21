"use client";
import type { EditPlan } from "@unfold/core";
import { sampleAnalysis } from "@unfold/core";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { actions, useStore, type State } from "@/lib/client/store";
import { AppHeader, HeaderLink } from "../AppHeader";
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
          <h1 className="t-h1">No edits yet</h1>
          <p className="t-body fg-2">Drop in a clip and Unfold writes nine edits of it.</p>
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
          <h1 className="t-h1">That run failed</h1>
          <p className="t-mono t-meta break-words text-danger">{run.error}</p>
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
            <div className="t-mono t-meta fg-3">
              {stats.count} edits · {fmtNum(stats.tokens)} tokens
              {stats.queueMs > 1000 && <> · {(stats.queueMs / 1000).toFixed(0)}s queued at Cerebras</>}
            </div>
            <h1 className="t-h1 mt-1.5 text-balance">Pick an edit to keep working on</h1>
            <p className="t-body fg-2 mt-1 max-w-xl text-balance">
              {project.prompt ? `“${project.prompt}”` : "Hover to preview, click to edit. Each one is a different hook, cut, track and caption style."}
            </p>
            {run.warning && <p className="t-meta mt-1 text-danger">{run.warning}</p>}
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
              <div key={`e${i}`} title={run.slotErrors[i] ?? ""} className="hair layer-1 flex aspect-[9/16] flex-col items-center justify-center gap-1 rounded-[16px] p-4 text-center">
                <span className="t-label">Edit {i + 1} didn&apos;t land</span>
                <span className="t-meta fg-3 line-clamp-3">{run.slotErrors[i]}</span>
              </div>
            ) : (
              <div key={`s${i}`} className="layer-2 aspect-[9/16] animate-pulse rounded-[16px]" />
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
        <HeaderLink href="/app" icon="upload">
          New clip
        </HeaderLink>
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
    <div ref={grid} className="relative mx-auto mt-8 grid max-w-[880px] grid-cols-2 gap-x-3 gap-y-7 sm:gap-x-5 md:grid-cols-3 lg:gap-x-7">
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

/** Count up to `target` over ~700ms whenever it changes (speed numbers). */
function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const x = a + (target - a) * e;
      setV(x);
      from.current = x;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function GeneratingView({ plan, reveal, run, plans }: { plan?: EditPlan; reveal: number; run: State["run"]; plans: State["plans"] }) {
  const { slots, slotErrors, status } = run;
  const queued = useElapsed(run.queuedAt ?? run.startedAt, run.firstAt ?? run.doneAt);
  const ready = slots.filter(Boolean).length;
  const failed = slotErrors.filter(Boolean).length;
  const landed = slots.flatMap((id) => (id && plans[id]?.stats ? [plans[id].stats!] : []));
  const tpsTarget = landed.length ? landed.reduce((a, s) => a + s.tps, 0) / landed.length : 0;
  const genTarget = landed.reduce((a, s) => Math.max(a, s.genMs), 0) / 1000;
  const tps = useCountUp(tpsTarget);
  const gen = useCountUp(genTarget);
  const tokens = useCountUp(landed.reduce((a, s) => a + s.outputTokens, 0));
  const live = landed.length > 0;
  const statusText =
    status === "preparing" ? `${run.phase ?? "Getting ready"}…` : status === "queued" ? "Queued at Cerebras…" : run.doneAt ? "Edits ready" : "Planning…";
  return (
    <Shell>
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 pb-16 pt-8 sm:px-6 md:grid-cols-[minmax(0,280px)_1fr] md:gap-12 md:pt-14">
        <div className="mx-auto w-full max-w-[280px]">
          <div className="hair relative aspect-[9/16] overflow-hidden rounded-[20px] bg-black">
            {plan ? <PlanPlayer plan={plan} muted autoPlay loop /> : <div className="layer-2 absolute inset-0 animate-pulse" />}
          </div>
        </div>

        <div className="min-w-0">
          <div className="t-h3 flex flex-wrap items-center gap-2">
            <span className={cx(status === "done" || run.doneAt ? "fg-1" : "shimmer")}>{statusText}</span>
            {status === "queued" && <span className="t-mono fg-3 text-[13px]">{(queued / 1000).toFixed(1)}s</span>}
          </div>
          <div className="t-meta fg-3 mt-0.5">Kimi K3.1 Pro on Cerebras · OpenClaw agent</div>

          {/* Hero: the speed moment */}
          <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-4">
            <Stat value={live ? fmtNum(tps) : "0"} unit="tok/s" dim={!live} accent />
            <Stat value={live ? gen.toFixed(2) : "0.00"} unit={`s for all ${slots.length}`} dim={!live} />
            <Stat value={live ? fmtNum(tokens) : "0"} unit="tokens" dim={!live} small />
          </div>

          {status === "queued" && (
            <p className="t-body fg-3 mt-4 max-w-lg text-balance">
              Cerebras is busy with hackathon traffic, so the request is waiting for a slot. Once it starts, all {slots.length} edits write in about a second,
              in parallel.
            </p>
          )}
          {status === "preparing" && run.phase?.startsWith("Watching") && (
            <p className="t-body fg-3 mt-4 max-w-lg text-balance">
              Downloading it, sampling frames and asking Kimi for its cut rate, caption style, zooms and sound. Your nine edits copy that style.
            </p>
          )}
          {run.warning && <p className="t-meta mt-2 text-danger">{run.warning}</p>}

          <div className="mt-6 flex items-center gap-3">
            <div className="flex gap-1">
              {slots.map((id, i) => (
                <span
                  key={i}
                  title={id ? plans[id]?.base.title : (slotErrors[i] ?? "planning…")}
                  className={cx(
                    "h-6 w-3.5 rounded-[3px] transition-colors duration-[var(--dur-2)]",
                    id ? "bg-flare" : slotErrors[i] ? "bg-danger/40" : "layer-2 hair animate-pulse",
                  )}
                />
              ))}
            </div>
            <span className="t-mono t-meta fg-3">
              {ready}/{slots.length} edits{failed ? ` · ${failed} failed` : ""}
            </span>
          </div>

          <ul className="t-body mt-5 space-y-1">
            {(plan ? decisions(plan) : []).map((d, i) => (
              <li
                key={i}
                className={cx("flex items-start gap-2 transition-[opacity,transform] duration-[var(--dur-2)] ease-out", d.track < reveal ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")}
              >
                <span className="text-violet">✓</span>
                <span className="fg-2 min-w-0">{d.text}</span>
              </li>
            ))}
          </ul>

          <div className="layer-1 hair mt-5 rounded-[12px] p-3">
            {plan ? <Timeline plan={plan} reveal={reveal} compact /> : <div className="layer-2 h-[190px] animate-pulse rounded-[8px]" />}
          </div>
        </div>
      </main>
    </Shell>
  );
}

function Stat({ value, unit, dim, accent, small }: { value: string; unit: string; dim?: boolean; accent?: boolean; small?: boolean }) {
  return (
    <div className={cx("transition-opacity duration-[var(--dur-3)]", dim && "opacity-35")}>
      <div
        className={cx(
          "t-mono leading-none tracking-[-0.04em]",
          small ? "text-[28px]" : "text-[56px] sm:text-[72px]",
          accent ? "text-violet" : "fg-1",
        )}
      >
        {value}
      </div>
      <div className="t-meta fg-3 mt-1.5">{unit}</div>
    </div>
  );
}
