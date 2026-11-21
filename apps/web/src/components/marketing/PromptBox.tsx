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
      className="w-full rounded-[20px] border border-border bg-surface p-2 shadow-[0_1px_2px_rgb(0_0_0/.04),0_20px_50px_-20px_rgb(0_0_0/.18)]"
    >
      <label htmlFor="mk-prompt" className="sr-only">What should this clip become?</label>
      <textarea
        id="mk-prompt"
        rows={2}
        placeholder="What should this clip become? e.g. fast montage, meme sounds on every kill"
        className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-muted"
      />

      {showLink && (
        <div className="mx-1 mt-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
          <IconLink size={15} className="shrink-0 text-violet" />
          <label htmlFor="mk-ref" className="sr-only">Inspiration video link</label>
          <input
            id="mk-ref"
            type="url"
            autoFocus
            placeholder="Paste a short-form video link to copy its style"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
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
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-[120ms] ${
                on ? "bg-ink text-bg" : "bg-surface-2 text-ink hover:bg-border"
              }`}
            >
              <span className="size-2 rounded-full" style={{ background: p.swatch }} />
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border px-1 pt-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={go}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <IconUpload size={16} />
            <span className="hidden sm:inline">Upload clip</span>
          </button>
          <button
            type="button"
            onClick={() => setShowLink((s) => !s)}
            aria-expanded={showLink}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-surface-2 hover:text-ink ${
              showLink ? "text-violet" : "text-ink-muted"
            }`}
          >
            <IconLink size={16} />
            <span className="sm:hidden">Inspo link</span>
            <span className="hidden sm:inline">Paste inspiration link</span>
          </button>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-flare px-4 text-[14px] font-semibold text-flare-ink transition-transform duration-[120ms] hover:brightness-105 active:scale-[.98]"
        >
          Unfold a clip
          <IconSend size={16} />
        </button>
      </div>
    </form>
  );
}
