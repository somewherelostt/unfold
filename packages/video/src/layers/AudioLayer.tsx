import React, { useMemo } from "react";
import { Audio, Sequence, interpolate } from "remotion";
import type { EditPlan } from "@unfold/core";
import { resolveSrc } from "../util";

/** Music (with ducking under speech + fades) and SFX hits. Source audio plays from the clips. */
export const AudioLayer: React.FC<{ plan: EditPlan; duck?: boolean; assetBase?: string }> = ({ plan, duck = true, assetBase }) => {
  const fps = plan.fps;
  const total = Math.max(1, Math.round(plan.durationSec * fps));
  const speech = useMemo(() => plan.captions.chunks.flatMap((c) => c.words.map((w) => [w.start, w.end] as const)), [plan]);

  const musicVolume = (f: number) => {
    const m = plan.music!;
    const t = f / fps;
    let v = m.volume;
    if (duck && speech.length) {
      let dist = Infinity;
      for (const [s, e] of speech) {
        if (t >= s && t <= e) {
          dist = 0;
          break;
        }
        dist = Math.min(dist, Math.abs(t - s), Math.abs(t - e));
      }
      v *= interpolate(dist, [0, 0.3], [0.62, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    }
    const fadeIn = interpolate(f, [0, 4], [0, 1], { extrapolateRight: "clamp" });
    const fadeOut = interpolate(f, [total - Math.round(0.6 * fps), total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return v * fadeIn * fadeOut;
  };

  return (
    <>
      {plan.music ? (
        <Audio
          src={resolveSrc(plan.music.url, assetBase)}
          trimBefore={Math.max(0, Math.round(plan.music.trackStart * fps))}
          volume={musicVolume}
          name="music"
        />
      ) : null}
      {plan.sfx.map((s, i) => {
        const from = Math.max(0, Math.round(s.at * fps) - 1); // land the transient on the frame
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, Math.min(total - from, fps * 3))} layout="none" name={`sfx ${s.name}`}>
            <Audio src={resolveSrc(s.url, assetBase)} volume={s.volume} />
          </Sequence>
        );
      })}
    </>
  );
};
