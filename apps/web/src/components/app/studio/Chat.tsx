"use client";
/**
 * Agent chat (360px). Agent replies: "Worked for 0.9s" with a collapsible step list, a one-line summary,
 * a change card (Keep / Revert) and the speed line. In generating mode it shows the live run instead.
 */
import type { EditPlan } from "@unfold/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { actions, isActive, useStore, type Run } from "@/lib/client/store";
import { planSteps } from "@/lib/client/narrate";
import type { ApiStats, ChatMsg } from "@/lib/client/types";
import { Button } from "@/components/ui/Button";
import { Shimmer } from "@/components/ui/Shimmer";
import { SpeedBadge } from "@/components/ui/SpeedBadge";
import { IconArrowUp, IconCheck, IconChevronRight, IconUndo } from "@/components/ui/icons";
import { cx } from "../ui";

const SUGGESTIONS = [
  { label: "Faster cuts", prompt: "Faster cuts, snappier pacing" },
  { label: "Less sound effects", prompt: "Less sound effects" },
  { label: "Make it 15s", prompt: "Make it 15 seconds" },
  { label: "Bigger captions", prompt: "Bigger, bolder captions" },
];

export function Chat({ id, plan, generating, run, reveal = 0, onAlternates }: { id?: string; plan?: EditPlan; generating?: boolean; run?: Run; reveal?: number; onAlternates?: () => void }) {
  const chat = useStore((s) => (id ? s.plans[id]?.chat : undefined)) ?? [];
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const pending = chat.some((m) => m.role === "agent" && m.pending);
  const disabled = generating || !id || pending;

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, pending, reveal, run?.status, run?.log?.length]);

  const send = (msg: string) => {
    const m = msg.trim();
    if (!m || disabled || !id) return;
    setText("");
    void actions.remix(id, m);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="chrome flex h-11 shrink-0 items-center gap-2 px-4 shadow-[inset_0_-1px_0_var(--hairline)]">
        <span className="relative flex size-2">
          {((generating && isActive(run)) || pending) && <span className="absolute inset-0 animate-ping rounded-full bg-agent opacity-60" />}
          <span className="relative size-2 rounded-full bg-agent" />
        </span>
        <span className="text-[13px] font-medium">Unfold agent</span>
        <span className="truncate text-[12px] text-text-3">Kimi K3.1 Pro on Cerebras</span>
      </div>

      <div ref={list} className="thin-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {generating && run ? <LiveRun run={run} plan={plan} reveal={reveal} /> : chat.map((m) => (m.role === "user" ? <UserMsg key={m.id} text={m.text} /> : <AgentMsg key={m.id} id={id!} msg={m} />))}
        {!generating && chat.length === 0 && plan && <p className="text-[13px] text-text-2">{plan.rationale} Tell me what to change.</p>}
      </div>

      <div className="px-3 pb-3">
        <div className="no-scrollbar -mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3">
          {SUGGESTIONS.map((s) => (
            <SuggestChip key={s.label} disabled={disabled} onClick={() => send(s.prompt)}>
              {s.label}
            </SuggestChip>
          ))}
          <SuggestChip disabled={generating || !id} onClick={onAlternates}>
            Try 3 alternate versions
          </SuggestChip>
        </div>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            send(text);
          }}
          className="rounded-[14px] bg-surface-1 p-1 shadow-[var(--shadow-raised)]"
        >
          <div className="flex items-end gap-1 rounded-[10px] bg-surface-2 p-1 shadow-[inset_0_0_0_1px_var(--hairline)]">
            <textarea
              value={text}
              rows={1}
              aria-label="Ask the agent for a change"
              disabled={generating}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(text);
                }
              }}
              placeholder={generating ? "Unfold is editing…" : "Ask for a change…"}
              className="max-h-28 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-5 text-text-1 outline-none placeholder:text-text-3 focus-visible:shadow-none"
            />
            {pending && id ? <button type="button" aria-label="Cancel remix" onClick={() => actions.cancelRemix(id)} className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-text-1"><span className="size-2 rounded-[2px] bg-current" /></button> : <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim() || disabled}
              className={cx("grid size-7 shrink-0 place-items-center rounded-full transition-opacity", text.trim() && !disabled ? "bg-primary-btn text-primary-btn-ink" : "bg-surface-3 text-text-4")}
            >
              <IconArrowUp size={14} />
            </button>}
          </div>
        </form>
      </div>
    </div>
  );
}

function SuggestChip({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...p}
      className="h-7 shrink-0 whitespace-nowrap rounded-full bg-surface-2 px-2.5 text-[12px] text-text-2 shadow-[inset_0_0_0_1px_var(--hairline)] transition-colors hover:bg-surface-3 hover:text-text-1 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function UserMsg({ text }: { text: string }) {
  return (
    <div className="flex justify-end pl-10">
      <div className="rounded-[12px] rounded-br-[4px] bg-surface-2 px-3 py-2 text-[13px] leading-5 text-text-1">{text}</div>
    </div>
  );
}

const secs = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`);

function Steps({ workedMs, steps, open: initial = false }: { workedMs?: number; steps?: string[]; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  if (workedMs === undefined) return null;
  return (
    <div className="mb-1.5">
      <button type="button" aria-expanded={steps?.length ? open : undefined} onClick={() => steps?.length && setOpen((o) => !o)} className="flex items-center gap-1 text-[12px] text-text-3 hover:text-text-2">
        Worked for <span className="tabular font-mono">{secs(workedMs)}</span>
        {steps?.length ? <IconChevronRight size={12} className={cx("transition-transform duration-150", open && "rotate-90")} /> : null}
      </button>
      {open && steps?.length ? (
        <div className="mt-1.5 border-l border-[var(--hairline-strong)] pl-3">
          <div className="mb-1 text-[11px] text-text-3">Ran {steps.length} steps</div>
          <ul className="space-y-0.5">
            {steps.map((s, i) => (
              <li key={i} className="text-[12px] leading-[18px] text-text-2">
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function AgentMsg({ id, msg }: { id: string; msg: Extract<ChatMsg, { role: "agent" }> }) {
  if (msg.pending) return <Pending startedAt={msg.startedAt} draft={msg.draft} />;
  return (
    <div className="uf-rise">
      <Steps workedMs={msg.workedMs} steps={msg.steps} />
      <p className="text-[13px] leading-5 text-text-1">{msg.text}</p>
      {msg.change && (
        <div className="mt-2.5 rounded-[12px] bg-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--hairline)]">
          <ul className="space-y-1">
            {msg.change.items.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-[18px] text-text-1">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-text-3" />
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex items-center gap-1.5">
            {msg.change.state === "open" ? (
              <>
                <Button size="sm" variant="secondary" className="h-7" onClick={() => actions.keepChange(id, msg.id)}>
                  <IconCheck size={14} /> Keep
                </Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => actions.revertChange(id, msg.id)}>
                  <IconUndo size={14} /> Revert
                </Button>
              </>
            ) : (
              <span className="text-[12px] text-text-3">{msg.change.state === "kept" ? "Kept" : "Reverted"}</span>
            )}
          </div>
        </div>
      )}
      {msg.stats && <Speed stats={msg.stats} label="re-planned in" />}
    </div>
  );
}

function Speed({ stats, label }: { stats: ApiStats; label: string }) {
  return (
    <div className="mt-2">
      <SpeedBadge seconds={stats.genMs / 1000} tps={stats.tps} label={label} model={false} />
    </div>
  );
}

function useTicker(startedAt?: number, active = true) {
  const [now, setNow] = useState(startedAt ?? 0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, [active]);
  return Math.max(0, now - (startedAt ?? now));
}

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function Pending({ startedAt, draft }: { startedAt?: number; draft?: string }) {
  const ms = useTicker(startedAt);
  return (
    <div className="text-[13px]">
      {draft ? (
        <Shimmer>
          Writing the new plan · <span className="tabular font-mono">~{Math.round(draft.length / 4)}</span> tokens
        </Shimmer>
      ) : ms > 4000 ? (
        <Shimmer>
          Queued at Cerebras · <span className="tabular font-mono">{mmss(ms)}</span>
        </Shimmer>
      ) : (
        <Shimmer>Planning…</Shimmer>
      )}
    </div>
  );
}

/** The live account of the first edit: prep steps, queue, then one step per track as it fills. */
function LiveRun({ run, plan, reveal }: { run: Run; plan?: EditPlan; reveal: number }) {
  const active = isActive(run);
  const elapsed = useTicker(run.startedAt, active);
  const queuedMs = useTicker(run.queuedAt ?? run.startedAt, active && !run.firstAt);
  const stats = useStore((s) => (run.slots[0] ? s.plans[run.slots[0]]?.stats : undefined));
  const decided = plan ? planSteps(plan).slice(0, reveal) : [];
  const done = !!plan && reveal >= 5 && run.status === "done";
  const t = (ms: number) => <span className="tabular w-10 shrink-0 font-mono text-[11px] text-text-4">{mmss(ms).replace(/^00:/, "0:")}</span>;
  return (
    <div className="space-y-1">
      {(run.log ?? []).map((l, i) => (
        <div key={i} className="uf-rise flex gap-2 text-[12px] leading-[18px] text-text-2">
          {t(l.at)}
          <span>{l.text}</span>
        </div>
      ))}
      {run.status === "preparing" && (
        <div className="flex gap-2 text-[12px] leading-[18px]">
          {t(elapsed)}
          <Shimmer>{run.phase ?? "Getting ready"}…</Shimmer>
        </div>
      )}
      {run.status === "queued" && (
        <div className="flex gap-2 text-[12px] leading-[18px]">
          {t((run.queuedAt ?? run.startedAt) - run.startedAt)}
          <Shimmer>
            Queued at Cerebras · <span className="tabular font-mono">{mmss(queuedMs)}</span>
          </Shimmer>
        </div>
      )}
      {run.status === "generating" && !plan && (
        <div className="flex gap-2 text-[12px] leading-[18px]">
          {t((run.queuedAt ?? run.startedAt) - run.startedAt)}
          <Shimmer>Planning the edit…</Shimmer>
        </div>
      )}
      {decided.map((s, i) => (
        <div key={i} className="uf-rise flex gap-2 text-[12px] leading-[18px] text-text-1">
          {t((run.firstAt ?? run.startedAt) - run.startedAt)}
          <span>{s}</span>
        </div>
      ))}
      {run.warning && <div className="pl-12 text-[12px] text-danger">{run.warning}</div>}
      {done && stats && (
        <div className="uf-rise mt-3 rounded-[12px] bg-surface-2 px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--hairline)]">
          <div className="text-[13px] font-medium text-text-1">Edit ready</div>
          <SpeedBadge seconds={stats.genMs / 1000} tps={stats.tps} model={false} className="mt-1" />
        </div>
      )}
    </div>
  );
}
