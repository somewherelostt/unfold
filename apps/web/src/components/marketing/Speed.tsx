"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconCheck } from "@/components/ui/icons";
import { Caption } from "./Caption";
import { useInView, useMotionScope, useParallax, useTimedProgress } from "./hooks";
import { PreviewVideo } from "./Preview";
import { CLIPS } from "./showcase-clips";

export function Speed() {
  const frame = useParallax<HTMLDivElement>(32, -16);
  const [replay, setReplay] = useState(0);

  return (
    <section id="speed" className="mk-flow-section mk-dark scroll-mt-24">
      <div className="mk-container mk-flow-layout">
        <div className="mk-flow-copy">
          <p className="mk-label">Keep shaping it</p>
          <h2 className="mk-flow-title">Direct the edit.<br />In your own words.</h2>
          <p className="mk-flow-intro">Ask for faster cuts, a different track or a new caption style. Keep refining until it feels like you.</p>
          <a href="/app" className="mk-flow-link">Start your edit <span aria-hidden>↗</span></a>
        </div>
        <div ref={frame} className="mk-flow-product">
          <EditingScene key={replay} />
          <div className="mk-flow-caption"><span>Caption style preview</span><Button variant="ghost" size="sm" onClick={() => setReplay((r) => r + 1)}>Replay</Button></div>
        </div>
      </div>
    </section>
  );
}

function EditingScene() {
  const { ref, live } = useMotionScope<HTMLDivElement>();
  const seen = useInView(ref, { amount: 0.35 });
  const step = useTimedProgress(2, seen && live, 900, 300);

  return (
    <div ref={ref} data-live={live} className="mk-motion mk-flow-window">
      <div className="mk-flow-toolbar"><span><img src="/logo-mark.svg" alt="" />creator_cut</span><span className="mk-flow-preview-tag">Preview</span></div>
      <div className="mk-flow-body">
        <div className="mk-flow-phone">
          <PreviewVideo src={CLIPS.creator.src} poster={CLIPS.creator.poster} className="mk-flow-footage" />
          <div className="mk-flow-captions mk-flow-captions-focus">
            {step < 2 ? <Caption words={CLIPS.creator.words} style="clean" size={18} /> : <div className="mk-flow-caption-build"><Caption words={CLIPS.creator.words} hot={CLIPS.creator.hot} style="focus" size={28} /></div>}
          </div>
          <div className="mk-flow-video-label"><span>Creator clip</span><span>9:16</span></div>
        </div>
        <div className="mk-flow-chat">
          <div className="mk-flow-user">Cleaner captions.<br />{" "}Highlight the key words.</div>
          <div className="mk-flow-reply">
            <p className="mk-flow-agent"><img src="/logo-mark.svg" alt="" /> Unfold</p>
            {step < 2 ? <p className={step === 1 ? "mk-shimmer" : "mk-flow-muted"}>Finding the rhythm of your clip…</p> : <p>Cleaner type.<br />{" "}Emphasis where it matters.</p>}
            <div className={`mk-flow-changes ${step >= 2 ? "is-ready" : ""}`}><span><IconCheck size={11} /> Emphasis</span><span><IconCheck size={11} /> Captions</span></div>
          </div>
        </div>
      </div>
      <div className="mk-flow-timeline" aria-hidden>
        <div className="mk-flow-ruler"><span>0:00</span><span>0:02</span><span>0:04</span><span>0:06</span></div>
        <div className="mk-flow-filmstrip">{Array.from({ length: 8 }, (_, i) => <img key={i} src={`/landing/creator-${i}.jpg`} alt="" />)}</div>
        <div className="mk-flow-audio">{Array.from({ length: 80 }, (_, i) => <span key={i} style={{ height: `${Math.round(20 + Math.abs(Math.sin(i * .82) * Math.cos(i * .3)) * 75)}%` }} />)}</div>
        <div className="mk-flow-playhead"><span className="mk-sweep" /></div>
      </div>
    </div>
  );
}
