"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconLink, IconSend, IconUpload } from "./icons";

const PRESETS = [
  { id: "gaming-montage", label: "Gaming Montage", swatch: "#FF5A1F" },
  { id: "podcast-clip", label: "Podcast Clip", swatch: "#2F80ED" },
  { id: "storytime", label: "Storytime", swatch: "#7B5CFF" },
  { id: "chaos", label: "Chaos", swatch: "#FF4FA3" },
] as const;

/** Prompt box. A preview of the product's home screen; submitting opens the app. */
export function PromptBox() {
  const router = useRouter();
  const [preset, setPreset] = useState<string | null>("gaming-montage");
  const [showLink, setShowLink] = useState(false);

  const go = () => router.push(preset ? `/app?preset=${preset}` : "/app");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="w-full rounded-2xl bg-surface p-2 text-left"
      style={{ boxShadow: "inset 0 0 0 .5px var(--mk-line-strong), 0 1px 2px rgb(0 0 0 / .04), 0 24px 48px -24px rgb(0 0 0 / .22)" }}
    >
      <label htmlFor="mk-prompt" className="sr-only">What should this clip become?</label>
      <textarea
        id="mk-prompt"
        rows={2}
        placeholder="What should this clip become? e.g. fast montage, meme sounds on every kill"
        className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[15px] leading-6 text-ink outline-none placeholder:text-[var(--mk-t4)] focus-visible:shadow-none"
      />

      {showLink && (
        <div className="mk-pop-in mk-hair mx-1 mt-2 flex items-center gap-2 rounded-lg px-3 py-2">
          <IconLink size={15} className="mk-t3 shrink-0" />
          <label htmlFor="mk-ref" className="sr-only">Inspiration video link</label>
          <input
            id="mk-ref"
            type="url"
            autoFocus
            placeholder="Paste a short-form video link to copy its style"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-[var(--mk-t4)] focus-visible:shadow-none"
          />
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 pb-1">
        {PRESETS.map((p) => {
          const on = preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => setPreset(on ? null : p.id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] ${
                on ? "bg-ink font-medium text-bg" : "mk-hair mk-hover mk-t2 hover:text-ink"
              }`}
            >
              <span className="size-2 rounded-full" style={{ background: p.swatch }} />
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="mk-hair-top mt-2 flex items-center justify-between gap-2 px-1 pt-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={go}
            className="mk-t3 inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] hover:bg-[var(--mk-tint-hover)] hover:text-ink"
          >
            <IconUpload size={16} />
            <span className="hidden sm:inline">Upload clip</span>
          </button>
          <button
            type="button"
            onClick={() => setShowLink((s) => !s)}
            aria-expanded={showLink}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] hover:bg-[var(--mk-tint-hover)] hover:text-ink ${
              showLink ? "text-ink" : "mk-t3"
            }`}
          >
            <IconLink size={16} />
            <span className="sm:hidden">Inspo link</span>
            <span className="hidden sm:inline">Paste inspiration link</span>
          </button>
        </div>
        <button
          type="submit"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-flare px-3.5 text-[14px] font-medium text-flare-ink transition-[filter] duration-150 hover:brightness-110"
        >
          Unfold a clip
          <IconSend size={16} />
        </button>
      </div>
    </form>
  );
}
