"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "./Chip";
import "./ui.css";
import { IconArrowUp, IconChevronDown, IconPlus, IconX } from "./icons";
import { savePromptDraft } from "./prompt-draft";

export type PromptPreset = { label: string; prompt: string };

export const DEFAULT_PRESETS: PromptPreset[] = [
  { label: "Viral captions", prompt: "Add captions that pop, word by word, with the key words highlighted" },
  { label: "Gaming montage", prompt: "Make my gameplay a hype montage: fast cuts on the beat, sounds on every kill" },
  { label: "Podcast clip", prompt: "Cut the best 30 seconds into a vertical clip with clean captions" },
  { label: "Storytime", prompt: "Make this a storytime: open on the hook, soft music, captions that follow my voice" },
  { label: "Hype reel", prompt: "Turn this into a hype reel with punch zooms, whip pans and a big drop" },
  { label: "Copy a style", prompt: "Copy the style of this video: " },
];

const STYLES = ["Auto", "Pop", "Clean", "Chaos", "Storytime"];
const ASPECTS = ["9:16", "1:1", "16:9"];

export type PromptSubmit = { prompt: string; file: File | null; style: string; aspect: string };

/**
 * The prompt shell: an 18px-radius shell with 6px padding around a 12px-radius field. Bottom row: attach,
 * style and aspect pills, round white send. Direction changes come only from explicit preset choices.
 * The whole shell is a drop target.
 * `briefs` rotate as a typed placeholder. Without `onSubmit` it opens the app with the prompt.
 */
export function PromptShell({
  presets = DEFAULT_PRESETS,
  showPresets = true,
  briefs,
  placeholder = "Describe your edit, or drop your clip…",
  working = false,
  onSubmit,
  className = "",
  autoFocus = false,
  defaultText = "",
  defaultStyle = "Auto",
  defaultAspect = "9:16",
  onAttach,
  onTextChange,
}: {
  presets?: PromptPreset[];
  showPresets?: boolean;
  briefs?: string[];
  placeholder?: string;
  working?: boolean;
  onSubmit?: (v: PromptSubmit) => void | Promise<void>;
  className?: string;
  autoFocus?: boolean;
  /** Initial prompt text (e.g. carried over from the landing page). */
  defaultText?: string;
  defaultStyle?: string;
  defaultAspect?: string;
  /** Called as soon as a clip is attached (lets the app start analysing before submit). */
  onAttach?: (file: File | null) => void;
  onTextChange?: (text: string) => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [text, setText] = useState(defaultText);
  const [file, setFile] = useState<File | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [style, setStyle] = useState(Math.max(0, STYLES.indexOf(defaultStyle)));
  const [aspect, setAspect] = useState(Math.max(0, ASPECTS.indexOf(defaultAspect)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const typed = useTypedPlaceholder(briefs, text.length === 0);

  useEffect(() => () => void (thumb && URL.revokeObjectURL(thumb)), [thumb]);
  useEffect(() => setText(defaultText), [defaultText]);
  useEffect(() => setStyle(Math.max(0, STYLES.indexOf(defaultStyle))), [defaultStyle]);
  useEffect(() => setAspect(Math.max(0, ASPECTS.indexOf(defaultAspect))), [defaultAspect]);

  const attach = (f: File | undefined | null) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) return setError("Choose a video clip.");
    setError(null);
    setFile(f);
    onAttach?.(f);
    setThumb(f.type.startsWith("video/") || f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    const v = { prompt: text.trim(), file, style: STYLES[style], aspect: ASPECTS[aspect] };
    setSubmitting(true);
    setError(null);
    try {
      if (onSubmit) return await onSubmit(v);
      const params = new URLSearchParams({ prompt: v.prompt, style: v.style, aspect: v.aspect });
      if (file) params.set("draft", await savePromptDraft(v));
      router.push(`/app?${params.toString()}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't open your edit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    attach(e.dataTransfer.files?.[0]);
  };

  return (
    <div className={`w-full ${className}`}>
      <form
        onSubmit={submit}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`relative overflow-hidden rounded-[18px] bg-surface-1 p-1.5 text-left transition-shadow duration-150 ${
          drag ? "shadow-[inset_0_0_0_1px_var(--hairline-strong)] outline-dashed outline-1 outline-offset-[-6px] outline-[var(--hairline-strong)]" : "shadow-[var(--shadow-raised)]"
        }`}
      >
        <div className="rounded-[12px] bg-surface-2 shadow-[inset_0_0_0_1px_var(--hairline)]">
          {file && (
            <div className="flex px-3 pt-3">
              <div className="relative size-14 overflow-hidden rounded-[10px] bg-surface-3 shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
                {thumb && file.type.startsWith("video/") && <video src={thumb} muted playsInline className="h-full w-full object-cover" />}
                {thumb && file.type.startsWith("image/") && <img src={thumb} alt="" className="h-full w-full object-cover" />}
                <button
                  type="button"
                  aria-label="Remove clip"
                  onClick={() => {
                    setFile(null);
                    setThumb(null);
                    onAttach?.(null);
                  }}
                  className="absolute right-0.5 top-0.5 grid size-5 cursor-pointer place-items-center rounded-full bg-black/70 text-white"
                >
                  <IconX size={11} />
                </button>
              </div>
            </div>
          )}
          <label className="sr-only" htmlFor={fieldId}>
            Describe your edit
          </label>
          <textarea
            id={fieldId}
            ref={area}
            rows={2}
            autoFocus={autoFocus}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onTextChange?.(e.target.value);
              setActive(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) void submit(e as unknown as FormEvent);
            }}
            placeholder={briefs && text.length === 0 ? typed || " " : placeholder}
            className="block min-h-[76px] w-full resize-none bg-transparent px-3.5 pt-3 text-[15px] leading-6 text-text-1 caret-accent outline-none placeholder:text-text-3"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                aria-label="Attach a clip"
                onClick={() => input.current?.click()}
                className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-colors hover:text-text-1"
              >
                <IconPlus size={14} />
              </button>
              <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ""; }} />
              <Pill onClick={() => setStyle((s) => (s + 1) % STYLES.length)} label="Caption style">
                {STYLES[style]}
              </Pill>
              <Pill onClick={() => setAspect((s) => (s + 1) % ASPECTS.length)} label="Aspect ratio" className="tabular font-mono text-[12px]">
                {ASPECTS[aspect]}
              </Pill>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="submit"
                aria-label="Unfold"
                disabled={submitting}
                className="grid size-8 cursor-pointer place-items-center rounded-full bg-primary-btn text-primary-btn-ink transition-opacity hover:opacity-90"
              >
                <IconArrowUp size={16} />
              </button>
            </div>
          </div>
        </div>
        {working && <span className="ui-agent-bar pointer-events-none absolute inset-x-6 bottom-0 h-0.5 rounded-full" />}
      </form>
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}

      {showPresets && (
        <div className="ui-chip-row mt-3 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:justify-center sm:overflow-visible">
          {presets.map((p) => (
            <Chip
              key={p.label}
              selected={active === p.label}
              onClick={() => {
                setText(p.prompt);
                onTextChange?.(p.prompt);
                setActive(p.label);
                area.current?.focus();
              }}
            >
              {p.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({ children, onClick, label, className = "" }: { children: React.ReactNode; onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1 ${className}`}
    >
      {children}
      <IconChevronDown size={12} className="text-text-3" />
    </button>
  );
}

/** Types each brief in (~24ms/char), holds, deletes, moves on. Static when motion is reduced. */
function useTypedPlaceholder(briefs: string[] | undefined, on: boolean) {
  const [out, setOut] = useState(briefs?.[0] ?? "");
  useEffect(() => {
    if (!briefs?.length || !on) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    let n = 0;
    let dir: 1 | -1 = 1;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = briefs[i % briefs.length];
      n += dir;
      setOut(s.slice(0, n));
      if (dir === 1 && n >= s.length) {
        dir = -1;
        t = setTimeout(tick, 2200);
      } else if (dir === -1 && n <= 0) {
        dir = 1;
        i++;
        t = setTimeout(tick, 280);
      } else t = setTimeout(tick, dir === 1 ? 34 : 14);
    };
    t = setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, [briefs, on]);
  return out;
}
