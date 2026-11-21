"use client";
import type { EditPlan } from "@unfold/core";
import type { ApiStats } from "@/lib/client/types";
import Link from "next/link";
import { useState } from "react";
import { captionFamily, useCaptionFonts } from "../fonts";
import { PlanPlayer } from "../preview/PlanPlayer";
import { STYLE_META, SpeedBadge, cx, fmtSec } from "../ui";

export function planThumb(plan: EditPlan, frames: { t: number; url: string }[]) {
  const t = plan.clips[0]?.srcStart ?? 0;
  return frames.reduce((b, f) => (Math.abs(f.t - t) < Math.abs(b.t - t) ? f : b), frames[0])?.url;
}

/** 9:16 phone frame. Shows a light poster; mounts the player and plays muted on hover/focus. */
export function PhoneFrame({ plan, frames, playing, className }: { plan: EditPlan; frames: { t: number; url: string }[]; playing: boolean; className?: string }) {
  useCaptionFonts();
  const firstChunk = plan.captions.enabled ? plan.captions.chunks[0] : undefined;
  return (
    <div className={cx("relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-black", className)}>
      {playing ? (
        <PlanPlayer plan={plan} muted autoPlay loop />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={planThumb(plan, frames)} alt="" className="absolute inset-0 size-full object-cover" />
          {plan.hookText && (
            <div className="absolute inset-x-[6%] top-[7%] rounded-[10px] bg-black/55 px-2 py-1.5 text-center font-black uppercase leading-[1.05] text-white text-[clamp(10px,2.6cqw,15px)]" style={{ fontFamily: captionFamily("bold-pop") }}>
              {plan.hookText}
            </div>
          )}
          {firstChunk && (
            <div
              className="absolute inset-x-[5%] text-center font-black leading-tight text-white"
              style={{
                top: { upper: "20%", center: "50%", lower: "74%" }[plan.captions.position],
                fontSize: "clamp(12px, 3.2cqw, 20px)",
                WebkitTextStroke: "3px #000",
                paintOrder: "stroke fill",
                textTransform: plan.captions.uppercase ? "uppercase" : "none",
                fontFamily: captionFamily(plan.captions.preset),
              }}
            >
              {firstChunk.words.map((w, i) => (
                <span key={i} style={{ color: w.emphasis ? plan.captions.highlightColor : undefined }}>
                  {w.text}{" "}
                </span>
              ))}
            </div>
          )}
          <div className="absolute bottom-2.5 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full bg-white/20 text-white opacity-0 backdrop-blur transition-opacity duration-[120ms] group-hover:opacity-100">
            ▶
          </div>
        </>
      )}
    </div>
  );
}

export function VariantCard({ plan, stats, index, frames }: { plan: EditPlan; stats?: ApiStats; index: number; frames: { t: number; url: string }[] }) {
  const [hover, setHover] = useState(false);
  const meta = STYLE_META[plan.style];
  return (
    <Link
      href={`/app/edit/${plan.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="group block rounded-xl outline-none [container-type:inline-size] focus-visible:ring-2 focus-visible:ring-flare"
    >
      <div className="relative transition-transform duration-[240ms] ease-out group-hover:-translate-y-1">
        <PhoneFrame plan={plan} frames={frames} playing={hover} className="group-hover:border-ink-muted group-hover:shadow-float" />
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[11px] text-white backdrop-blur tabular">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <div className="mt-2.5 px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={{ background: meta.swatch[0] }} />
          <span className="truncate text-[15px] font-semibold">{plan.title}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-ink-muted">{plan.rationale}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink-muted tabular">
          <span>{fmtSec(plan.durationSec)}</span>·<span>{plan.clips.length} cuts</span>·<span>{plan.sfx.length} sfx</span>
          {plan.music && (
            <>
              ·<span>{plan.music.bpm} bpm</span>
            </>
          )}
        </div>
        {stats && <SpeedBadge ms={stats.genMs} tps={stats.tps} label="" className="mt-1.5 !text-[11px]" />}
      </div>
    </Link>
  );
}
