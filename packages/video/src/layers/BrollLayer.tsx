import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence } from "remotion";
import type { EditPlan } from "@unfold/core";
import { resolveBrollPlacements } from "../broll";
import { resolveSrc } from "../util";

/** Supporting pictures cover the primary picture while its narration keeps playing underneath. */
export const BrollLayer: React.FC<{ plan: EditPlan; assetBase?: string }> = ({ plan, assetBase }) => (
  <>
    {resolveBrollPlacements(plan).map(({ shot, asset: source, from, durationInFrames, trimBefore, fit }) => {
      return (
        <Sequence key={shot.id} from={from} durationInFrames={durationInFrames} layout="none" name={`B-roll: ${source.name}`}>
          <AbsoluteFill style={{ backgroundColor: "#000" }}>
            <OffthreadVideo src={resolveSrc(source.src, assetBase)} trimBefore={trimBefore} trimAfter={trimBefore + durationInFrames}
              playbackRate={1} muted volume={0} pauseWhenBuffering
              style={{ width: "100%", height: "100%", objectFit: fit, objectPosition: fit === "cover" && source.width / source.height < plan.width / plan.height ? "50% 38%" : "50% 50%" }} />
          </AbsoluteFill>
        </Sequence>
      );
    })}
  </>
);
