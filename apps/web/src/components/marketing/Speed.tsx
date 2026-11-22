"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconCheck } from "@/components/ui/icons";
import { Caption } from "./Caption";
import { useInView, useMotionScope, useParallax, useTicker, useTimedProgress } from "./hooks";
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
          <p className="mk-flow-intro">The first cut is just the beginning. Ask for sharper pacing, a new track or captions that feel more like you.</p>
          <a href="/app" className="mk-flow-link">Start your edit <span aria-hidden>↗</span></a>
          <div className="mk-flow-powered"><img src="/logo-mark.svg" width={18} height={18} alt="" /><span>Kimi K3.1 Pro on Cerebras<br /><span>Orchestrated with OpenClaw</span></span></div>
        </div>
        <div ref={frame} className="mk-flow-product">
          <EditingScene key={replay} />
          <div className="mk-flow-caption"><span>Example footage and illustrative edits.</span><Button variant="ghost" size="sm" onClick={() => setReplay((r) => r + 1)}>Replay</Button></div>
        </div>
      </div>
    </section>
  );
}

function EditingScene() {
  const { ref, live } = useMotionScope<HTMLDivElement>();
  const seen = useInView(ref, { amount: 0.35 });
  const step = useTimedProgress(2, seen && live, 900, 300);
  const word = useTicker(CLIPS.vlog.words.length, 460, step >= 2 && live);

  return (
    <div ref={ref} data-live={live} className="mk-motion mk-flow-window">
      <div className="mk-flow-toolbar"><span><img src="/logo-mark.svg" alt="" />weekend_story</span><span className="mk-flow-preview-tag">Preview</span></div>
      <div className="mk-flow-body">
        <div className="mk-flow-phone">
          <PreviewVideo src={CLIPS.vlog.src} poster={CLIPS.vlog.poster} className="mk-flow-footage" />
          <div className="mk-flow-captions">
            {step < 2 ? <Caption words={CLIPS.vlog.words} style="clean" size={18} /> : <div key={word} className="mk-pop"><Caption words={[CLIPS.vlog.words[word]]} hot={[0]} size={32} /></div>}
          </div>
          <div className="mk-flow-video-label"><span>Talking head</span><span>9:16</span></div>
        </div>
        <div className="mk-flow-chat">
          <div className="mk-flow-user">Faster cuts.<br />Bigger captions.</div>
          <div className="mk-flow-reply">
            <p className="mk-flow-agent"><img src="/logo-mark.svg" alt="" /> Unfold</p>
            {step < 2 ? <p className={step === 1 ? "mk-shimmer" : "mk-flow-muted"}>Finding the rhythm of your clip…</p> : <p>Cut tighter.<br />Let the words stand out.</p>}
            <div className={`mk-flow-changes ${step >= 2 ? "is-ready" : ""}`}><span><IconCheck size={11} /> Pacing</span><span><IconCheck size={11} /> Captions</span></div>
          </div>
        </div>
      </div>
      <div className="mk-flow-timeline" aria-hidden>
        <div className="mk-flow-ruler"><span>0:00</span><span>0:02</span><span>0:04</span><span>0:06</span></div>
        <div className="mk-flow-filmstrip">{Array.from({ length: 8 }, (_, i) => <img key={i} src={CLIPS.vlog.poster} alt="" style={{ objectPosition: `${i * 14}% 50%` }} />)}</div>
        <div className="mk-flow-audio">{Array.from({ length: 80 }, (_, i) => <span key={i} style={{ height: `${Math.round(20 + Math.abs(Math.sin(i * .82) * Math.cos(i * .3)) * 75)}%` }} />)}</div>
        <div className="mk-flow-playhead"><span className="mk-sweep" /></div>
      </div>
    </div>
  );
}
