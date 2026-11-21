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
      <div className="hair-b chrome flex h-10 shrink-0 items-center gap-2 px-3">
        <span className="flex size-5 items-center justify-center rounded-full bg-[var(--violet-12)] text-violet">
          <Icon name="sparkle" className="size-3" />
        </span>
        <span className="t-label">Unfold agent</span>
        <span className="t-meta fg-3 truncate">Kimi K3.1 Pro on Cerebras</span>
      </div>

      <div ref={list} className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <AgentBubble text={`I cut this as “${plan.title}”. ${plan.rationale} Tell me what to change.`} />
        {chat.map((m) => (m.role === "user" ? <UserBubble key={m.id} text={m.text} /> : <AgentBubble key={m.id} msg={m} />))}
      </div>

      <div className="hair-t p-2">
        {manual ? (
          <div className="layer-2 t-body flex items-center justify-between gap-2 rounded-[8px] py-1.5 pl-3 pr-1.5">
            <span className="fg-3">Agent paused while you edit manually.</span>
            <Button size="sm" variant="ghost" onClick={onResume}>
              Resume
            </Button>
          </div>
        ) : (
          <>
            <div className="no-scrollbar mb-2 flex gap-1 overflow-x-auto">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  disabled={pending}
                  onClick={() => send(s)}
                  className="tint hair hair-hover t-meta fg-2 shrink-0 rounded-full px-2.5 py-1 hover:text-[var(--fg-1)] disabled:opacity-40"
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
              className="layer-2 hair flex items-end gap-1 rounded-[10px] p-1 focus-within:shadow-[inset_0_0_0_0.5px_var(--hair-strong)]"
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
                placeholder="Remix it: cut the intro, louder music"
                className="t-body max-h-28 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-[var(--fg-4)] focus-visible:shadow-none"
              />
              <button
                type="submit"
                disabled={!text.trim() || pending}
                aria-label="Send"
                className={cx(
                  "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-[var(--dur-1)]",
                  text.trim() && !pending ? "bg-violet text-white" : "bg-[var(--tint-press)] text-[var(--fg-4)]",
                )}
              >
                <Icon name="send" className="size-3.5" />
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
    <div className="flex justify-end pl-8">
      <div className="layer-1 hair t-body rounded-[10px] rounded-br-[3px] px-2.5 py-1.5 shadow-[var(--shadow-low)]">{text}</div>
    </div>
  );
}

/** Assistant replies have no bubble: plain text, speed stat underneath. */
function AgentBubble({ text, msg }: { text?: string; msg?: Extract<ChatMsg, { role: "agent" }> }) {
  return (
    <div className="pr-4">
      <div className="t-body fg-1">{msg?.pending ? <Thinking draft={msg.draft} /> : (text ?? msg?.text)}</div>
      {msg?.stats && <SpeedBadge ms={msg.stats.genMs} tps={msg.stats.tps} label="re-planned in" className="mt-1.5" />}
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
      <span className="shimmer">{draft ? "Writing the new plan…" : ms > 4000 ? "Queued at Cerebras…" : "Planning…"}</span>
      <span className="t-mono fg-3 text-[11px] font-normal">
        {(ms / 1000).toFixed(1)}s{draft ? ` · ~${Math.round(draft.length / 4).toLocaleString("en-US")} tokens` : ""}
      </span>
    </span>
  );
}
