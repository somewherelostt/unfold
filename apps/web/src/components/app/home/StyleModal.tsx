"use client";
import { useEffect, useRef, useState } from "react";
import type { StyleChoice } from "@/lib/client/types";
import { captionFamily, useCaptionFonts } from "../fonts";
import { Button, Icon, STYLE_META, cx } from "../ui";

const PRESETS = ["gaming-montage", "podcast-clip", "storytime", "chaos"] as const;

const SAMPLE_CAPTION: Record<(typeof PRESETS)[number], { text: string; font: string; hi: string }> = {
  "gaming-montage": { text: "THIS GAME IS BROKEN", font: captionFamily("bold-pop"), hi: "#FFE14D" },
  "podcast-clip": { text: "the craziest thing", font: captionFamily("clean-pop"), hi: "#FFE14D" },
  storytime: { text: "wait for it…", font: captionFamily("story"), hi: "#FF5A1F" },
  chaos: { text: "BRO WHAT 💀", font: captionFamily("meme"), hi: "#FF4FA3" },
};

export function StyleModal({
  open,
  onClose,
  onPick,
  initial,
  referenceUrl,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (s: StyleChoice) => void;
  initial: StyleChoice | null;
  referenceUrl: string;
}) {
  const [link, setLink] = useState(referenceUrl);
  const dialog = useRef<HTMLDialogElement>(null);
  useCaptionFonts();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setLink(referenceUrl);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, referenceUrl]);

  const selectedPreset = initial?.kind === "preset" ? initial.preset : null;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="m-auto w-[min(920px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-xl border border-border bg-surface p-0 text-ink shadow-float backdrop:bg-black/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-[28px] font-bold leading-[32px] tracking-[-0.015em] sm:text-[32px] sm:leading-[38px]">Pick a style</h2>
            <p className="mt-1 text-[15px] text-ink-muted">Unfold makes nine edits in this direction. You can remix any of them after.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {PRESETS.map((p) => {
            const m = STYLE_META[p];
            const cap = SAMPLE_CAPTION[p];
            return (
              <button
                key={p}
                onClick={() => onPick({ kind: "preset", preset: p })}
                className={cx(
                  "group rounded-lg border bg-surface p-2 text-left transition-[border-color,transform] duration-[120ms] hover:-translate-y-0.5 hover:border-ink",
                  selectedPreset === p ? "border-flare ring-2 ring-flare/30" : "border-border",
                )}
              >
                <div
                  className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-md"
                  style={{ background: `linear-gradient(160deg, ${m.swatch[1]} 0%, #222 100%)` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/demo/frame-12.jpg" alt="" className="absolute inset-0 size-full object-cover opacity-60 transition-transform duration-[240ms] group-hover:scale-105" />
                  <span
                    className="relative px-2 text-center text-[18px] font-black leading-tight text-white"
                    style={{ fontFamily: cap.font, WebkitTextStroke: "4px #000", paintOrder: "stroke fill", color: cap.hi }}
                  >
                    {cap.text}
                  </span>
                </div>
                <div className="mt-2.5 flex gap-1">
                  {m.swatch.map((c) => (
                    <span key={c} className="h-2 flex-1 rounded-full border border-border" style={{ background: c }} />
                  ))}
                </div>
                <div className="mt-2 px-0.5 text-[15px] font-semibold">{m.label}</div>
                <div className="px-0.5 pb-1 text-[13px] text-ink-muted">{m.blurb}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) onPick({ kind: "link", url: link.trim() });
            }}
            className={cx("rounded-lg border p-4", initial?.kind === "link" ? "border-flare" : "border-border")}
          >
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <Icon name="link" className="text-violet" /> Copy from link
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">Unfold watches the video and copies its cut rate, captions, zooms and sound.</p>
            <div className="mt-3 flex gap-2">
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Link to a short-form video"
                className="h-10 min-w-0 flex-1 rounded-sm border border-border bg-surface-2 px-3 text-[14px] outline-none placeholder:text-ink-muted focus:border-flare"
              />
              <Button type="submit" disabled={!link.trim()}>
                Copy style
              </Button>
            </div>
          </form>
          <button
            onClick={() => onPick({ kind: "auto" })}
            className={cx(
              "flex flex-col justify-between rounded-lg border p-4 text-left transition-colors duration-[120ms] hover:border-ink",
              initial?.kind === "auto" ? "border-flare" : "border-border",
            )}
          >
            <div>
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                <Icon name="sparkle" className="text-violet" /> Let Unfold decide
              </div>
              <p className="mt-1 text-[13px] text-ink-muted">The agent reads your clip and spreads nine edits across every style.</p>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-[14px] font-medium text-flare">
              Unfold 9 edits <Icon name="arrow" className="size-4" />
            </span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
