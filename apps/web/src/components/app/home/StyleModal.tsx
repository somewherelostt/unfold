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
      className="uf-dialog layer-1 float m-auto max-h-[calc(100dvh-24px)] w-[min(880px,calc(100vw-24px))] overflow-y-auto rounded-[16px] p-0 text-[var(--fg-1)]"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="t-h1">Pick a style</h2>
            <p className="t-body fg-2 mt-1">Unfold makes nine edits in this direction. You can remix any of them after.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {PRESETS.map((p) => {
            const m = STYLE_META[p];
            const cap = SAMPLE_CAPTION[p];
            const sel = selectedPreset === p;
            return (
              <button
                key={p}
                onClick={() => onPick({ kind: "preset", preset: p })}
                className={cx(
                  "tint group rounded-[12px] p-1.5 text-left",
                  sel ? "bg-[var(--flare-10)] shadow-[inset_0_0_0_1px_var(--flare)]" : "hair hair-hover",
                )}
              >
                <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[8px] bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/demo/frame-12.jpg" alt="" className="absolute inset-0 size-full object-cover opacity-60 transition-transform duration-[var(--dur-3)] ease-out group-hover:scale-105" />
                  <span
                    className="relative px-2 text-center text-[18px] leading-tight"
                    style={{ fontFamily: cap.font, fontWeight: 900, WebkitTextStroke: "4px #000", paintOrder: "stroke fill", color: cap.hi }}
                  >
                    {cap.text}
                  </span>
                </div>
                <div className="mt-2 flex gap-0.5 px-0.5">
                  {m.swatch.map((c) => (
                    <span key={c} className="h-1.5 flex-1 rounded-full shadow-[inset_0_0_0_0.5px_rgb(0_0_0/.15)]" style={{ background: c }} />
                  ))}
                </div>
                <div className={cx("t-h3 mt-2 px-0.5", sel && "text-flare")}>{m.label}</div>
                <div className="t-meta fg-3 px-0.5 pb-1">{m.blurb}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) onPick({ kind: "link", url: link.trim() });
            }}
            className={cx("rounded-[12px] p-4", initial?.kind === "link" ? "bg-[var(--flare-10)] shadow-[inset_0_0_0_1px_var(--flare)]" : "hair")}
          >
            <div className="t-h3 flex items-center gap-2">
              <Icon name="link" className="text-[var(--fg-3)]" /> Copy from link
            </div>
            <p className="t-body fg-3 mt-1">Unfold watches the video and copies its cut rate, captions, zooms and sound.</p>
            <div className="mt-3 flex gap-2">
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Link to a short-form video"
                className="layer-2 t-body h-9 min-w-0 flex-1 rounded-[8px] px-3 outline-none placeholder:text-[var(--fg-4)]"
              />
              <Button type="submit" disabled={!link.trim()}>
                Copy style
              </Button>
            </div>
          </form>
          <button
            onClick={() => onPick({ kind: "auto" })}
            className={cx(
              "tint flex flex-col justify-between rounded-[12px] p-4 text-left",
              initial?.kind === "auto" ? "bg-[var(--flare-10)] shadow-[inset_0_0_0_1px_var(--flare)]" : "hair hair-hover",
            )}
          >
            <div>
              <div className="t-h3 flex items-center gap-2">
                <Icon name="sparkle" className="text-violet" /> Let Unfold decide
              </div>
              <p className="t-body fg-3 mt-1">The agent reads your clip and spreads nine edits across every style.</p>
            </div>
            <span className="t-label mt-3 inline-flex items-center gap-1 text-flare">
              Unfold 9 edits <Icon name="arrow" />
            </span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
