"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/ui/icons";
import { Caption } from "./Caption";
import { useMotionScope, useTicker } from "./hooks";
import { PreviewVideo } from "./Preview";
import { CLIPS, type Clip } from "./showcase-clips";

type Look = { name: string; clip: Clip; treatment: "clean" | "bold" | "cinematic"; brief: string };
const LOOKS: Look[] = [
  { name: "Clean", clip: CLIPS.creator, treatment: "clean", brief: "Create a clean, natural edit with clear captions and subtle emphasis." },
  { name: "Bold", clip: CLIPS.gaming, treatment: "bold", brief: "Make a high-energy edit with bold captions, quick cuts and punchy sound effects." },
  { name: "Cinematic", clip: CLIPS.coast, treatment: "cinematic", brief: "Make a cinematic edit with considered pacing, understated captions and atmospheric music." },
];

export function Features() {
  return (
    <section id="styles" className="mk-section mk-looks-section scroll-mt-24" aria-labelledby="looks-title">
      <div className="mk-container">
        <div className="mk-looks-heading">
          <div><p className="mk-label">Style previews</p><h2 id="looks-title" className="mk-title mt-3">Find your look.</h2></div>
          <ButtonLink href="/app" variant="primary" size="lg">Start editing</ButtonLink>
        </div>
        <div className="mk-look-gallery" role="list" aria-label="Example editing styles">
          {LOOKS.map((look) => <LookPreview key={look.name} look={look} />)}
        </div>
      </div>
    </section>
  );
}

function LookPreview({ look }: { look: Look }) {
  const { ref, live } = useMotionScope<HTMLDivElement>();
  const word = useTicker(look.clip.words.length, 520, live && look.treatment === "bold");
  return (
    <div ref={ref} data-live={live} className="mk-motion mk-look-card" role="listitem">
      <Link href={`/app?prompt=${encodeURIComponent(look.brief)}`} aria-label={`Try the ${look.name.toLowerCase()} editing style`}>
        <div className={`mk-look-media mk-look-media-${look.treatment}`}>
          <PreviewVideo src={look.clip.src} poster={look.clip.poster} className="mk-look-footage" />
          <div className="mk-look-shade" />
          <div className={`mk-look-caption mk-look-caption-${look.treatment}`} aria-hidden>
            {look.treatment === "cinematic" ? <><span>One more</span><em>wave.</em></> : look.treatment === "bold" ? <div key={word} className="mk-pop"><Caption words={look.clip.words} hot={look.clip.hot} lit={word} style="pop" size={38} /></div> : <div className="mk-look-focus-stack"><Caption words={look.clip.words.slice(0, 2)} style="focus" size={36} /><Caption words={look.clip.words.slice(2)} hot={[0, 1]} style="focus" size={36} /></div>}
          </div>
          <span className="mk-look-open" aria-hidden><IconArrowRight size={18} /></span>
        </div>
        <div className="mk-look-meta"><h3>{look.name}</h3><span>{look.clip.tag}</span></div>
      </Link>
    </div>
  );
}
