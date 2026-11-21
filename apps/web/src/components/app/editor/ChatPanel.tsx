"use client";
import type { EditPlan } from "@unfold/core";
import { useEffect, useRef, useState } from "react";
import { actions } from "@/lib/client/store";
import type { ChatMsg } from "@/lib/client/types";
import { Button, Icon, SpeedBadge, cx } from "../ui";

const SUGGESTIONS = ["faster pacing", "less meme sounds", "make it 15s", "more zoom punches", "hype music on the drop", "new hook"];

export function ChatPanel({ id, plan, chat, manual, onResume }: { id: string; plan: EditPlan; chat: ChatMsg[]; manual: boolean; onResume: () => void }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const pending = chat.some((m) => m.role === "agent" && m.pending);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, pending]);

  const send = (msg: string) => {
    const m = msg.trim();
    if (!m || pending) return;
    setText("");
    void actions.remix(id, m);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex size-6 items-center justify-center rounded-full bg-violet/15 text-violet">
          <Icon name="sparkle" className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold leading-5">Unfold agent</div>
          <div className="text-[11px] leading-4 text-ink-muted">Kimi K3.1 Pro on Cerebras</div>
        </div>
      </div>

      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <AgentBubble text={`I cut this as “${plan.title}”. ${plan.rationale} Tell me what to change.`} />
        {chat.map((m) => (m.role === "user" ? <UserBubble key={m.id} text={m.text} /> : <AgentBubble key={m.id} msg={m} />))}
      </div>

      <div className="border-t border-border p-3">
        {manual ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[13px]">
            <span className="text-ink-muted">Agent paused while you edit manually.</span>
            <Button size="sm" variant="ghost" onClick={onResume}>
              Resume
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  disabled={pending}
                  onClick={() => send(s)}
                  className="rounded-full border border-border px-2.5 py-1 text-[12px] text-ink-muted transition-colors duration-[120ms] hover:border-violet hover:text-violet disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
              className="flex items-end gap-2 rounded-md border border-border bg-surface-2 p-1.5 focus-within:border-violet"
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(text);
                  }
                }}
                rows={1}
                placeholder="Remix it: “cut the intro, louder music”"
                className="max-h-28 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[14px] outline-none placeholder:text-ink-muted"
              />
              <button
                type="submit"
                disabled={!text.trim() || pending}
                aria-label="Send"
                className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-violet text-white disabled:opacity-40"
              >
                <Icon name="send" className="size-4" />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg rounded-br-sm bg-ink px-3 py-2 text-[14px] leading-5 text-bg">{text}</div>
    </div>
  );
}

function AgentBubble({ text, msg }: { text?: string; msg?: Extract<ChatMsg, { role: "agent" }> }) {
  return (
    <div className="max-w-[92%]">
      <div className={cx("rounded-lg rounded-bl-sm bg-surface-2 px-3 py-2 text-[14px] leading-5", msg?.pending && "text-ink-muted")}>
        {msg?.pending ? <Thinking draft={msg.draft} /> : (text ?? msg?.text)}
      </div>
      {msg?.stats && <SpeedBadge ms={msg.stats.genMs} tps={msg.stats.tps} label="re-planned in" className="mt-1.5 !text-[11px]" />}
    </div>
  );
}

function Thinking({ draft }: { draft?: string }) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      setMs(performance.now() - t0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-bounce rounded-full bg-violet" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </span>
      {draft ? "Writing the new plan" : ms > 4000 ? "Queued at Cerebras" : "Re-planning"}{" "}
      <span className="font-mono text-[12px] tabular">
        {(ms / 1000).toFixed(1)}s{draft ? ` · ~${Math.round(draft.length / 4).toLocaleString("en-US")} tokens` : ""}
      </span>
    </span>
  );
}
