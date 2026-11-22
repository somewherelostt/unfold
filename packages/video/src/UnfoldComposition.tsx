import React, { useId } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { EditPlan } from "@unfold/core";
import { ensureFonts } from "./fonts";
import { computeFx } from "./fx";
import { AudioLayer } from "./layers/AudioLayer";
import { Captions } from "./layers/Captions";
import { Hook, Overlays } from "./layers/TextPops";
import { VideoLayer } from "./layers/VideoLayer";

ensureFonts();

export type UnfoldCompositionProps = {
  plan: EditPlan;
  /** Prefix for relative media URLs (e.g. "http://localhost:3000"). Optional. */
  assetBase?: string;
  /** Duck music under speech. Default true. */
  duckMusic?: boolean;
};

export const UnfoldComposition: React.FC<UnfoldCompositionProps> = ({ plan, assetBase, duckMusic = true }) => {
  const frame = useCurrentFrame();
  const t = frame / plan.fps;
  const fx = computeFx(plan, t, frame);
  const filterId = "uf" + useId().replace(/[^a-zA-Z0-9]/g, "");

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000",
        overflow: "hidden",
      }}
    >
      <VideoLayer plan={plan} fx={fx} filterId={filterId} assetBase={assetBase} />
      {plan.style === "storytime" ? (
        <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,.35) 100%)" }} />
      ) : null}
      {fx.flash > 0.01 ? <AbsoluteFill style={{ backgroundColor: "#FFFFFF", opacity: Math.min(1, fx.flash) }} /> : null}
      <Overlays plan={plan} />
      <Captions plan={plan} />
      <Hook plan={plan} />
      <AudioLayer plan={plan} duck={duckMusic} assetBase={assetBase} />
    </AbsoluteFill>
  );
};
