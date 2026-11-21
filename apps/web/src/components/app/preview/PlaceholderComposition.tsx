"use client";
/**
 * Stand-in for `UnfoldComposition` from @unfold/video (same props: { plan: EditPlan }).
 * Renders the real cut (clips, speed), captions, hook text, zooms, flash transitions, music and SFX
 * so the preview is meaningful before the real composition lands. Swap in `./composition.ts`.
 */
import type { EditPlan } from "@unfold/core";
import { captionFamily } from "../fonts";
import { AbsoluteFill, Html5Audio, Html5Video, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

const FONTS: Record<EditPlan["captions"]["preset"], string> = {
  "bold-pop": captionFamily("bold-pop"),
  "clean-pop": captionFamily("clean-pop"),
  meme: captionFamily("meme"),
  story: captionFamily("story"),
  karaoke: captionFamily("karaoke"),
};

export function PlaceholderComposition({ plan }: { plan: EditPlan }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const f = (s: number) => Math.max(0, Math.round(s * fps));
  const u = width / 1080; // scale unit

  // Zoom
  let scale = 1;
  for (const z of plan.zooms) {
    if (t < z.start || t > z.end) continue;
    const p = (t - z.start) / Math.max(0.01, z.end - z.start);
    scale = Math.max(
      scale,
      z.kind === "punch" ? 1 + (z.scale - 1) * Math.sin(Math.min(1, p) * Math.PI) : 1 + (z.scale - 1) * p,
    );
  }
  // Transition flash / shake
  let flash = 0;
  let shake = 0;
  for (const tr of plan.transitions) {
    const d = Math.abs(t - tr.at);
    const w = Math.max(0.08, tr.durationSec / 2);
    if (d > w) continue;
    const k = 1 - d / w;
    if (tr.type === "flash" || tr.type === "zoom-punch") flash = Math.max(flash, k * 0.85);
    if (tr.type === "shake" || tr.type === "glitch" || tr.type === "whip") shake = Math.max(shake, k);
  }
  const shakeX = shake ? Math.sin(frame * 2.3) * 24 * u * shake : 0;
  const shakeY = shake ? Math.cos(frame * 3.1) * 14 * u * shake : 0;

  const chunk = plan.captions.enabled ? plan.captions.chunks.find((c) => t >= c.start && t <= c.end + 0.08) : undefined;
  const capTop = { upper: "18%", center: "50%", lower: "74%" }[plan.captions.position];
  const fontSize = (plan.captions.preset === "story" || plan.captions.preset === "clean-pop" ? 70 : 92) * u;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${shakeX}px, ${shakeY}px) scale(${scale})` }}>
        {plan.clips.map((c) => (
          <Sequence key={c.id} from={f(c.start)} durationInFrames={Math.max(1, f(c.end) - f(c.start))} premountFor={fps}>
            <Html5Video
              src={plan.source.src}
              trimBefore={f(c.srcStart)}
              playbackRate={c.speed}
              muted={false}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Sequence>
        ))}
      </AbsoluteFill>

      {plan.music && <Html5Audio src={plan.music.url} trimBefore={f(plan.music.trackStart)} volume={plan.music.volume} />}
      {plan.sfx.map((s, i) => (
        <Sequence key={i} from={f(s.at)} durationInFrames={f(1.5)}>
          <Html5Audio src={s.url} volume={s.volume} />
        </Sequence>
      ))}

      {plan.hookText && t < 2.2 && (
        <div
          style={{
            position: "absolute",
            top: "7%",
            left: "6%",
            right: "6%",
            textAlign: "center",
            fontFamily: FONTS["bold-pop"],
            fontWeight: 900,
            fontSize: 78 * u,
            lineHeight: 1.05,
            color: "#fff",
            background: "rgba(0,0,0,.55)",
            borderRadius: 18 * u,
            padding: `${14 * u}px ${20 * u}px`,
            opacity: interpolate(t, [0, 0.15, 1.9, 2.2], [0, 1, 1, 0], { extrapolateRight: "clamp" }),
          }}
        >
          {plan.hookText}
        </div>
      )}

      {plan.overlays
        .filter((o) => t >= o.start && t <= o.end)
        .map((o, i) => (
          <div key={i} style={{ position: "absolute", top: "32%", width: "100%", textAlign: "center", color: "#FFE14D", fontSize: 64 * u, fontWeight: 900 }}>
            {o.text}
          </div>
        ))}

      {chunk && (
        <div
          style={{
            position: "absolute",
            top: capTop,
            left: "5%",
            right: "5%",
            transform: `translateY(-50%) scale(${interpolate(t - chunk.start, [0, 0.08, 0.16], [0.7, 1.08, 1], { extrapolateRight: "clamp" })})`,
            textAlign: "center",
            fontFamily: FONTS[plan.captions.preset],
            fontWeight: 900,
            fontSize,
            lineHeight: 1.1,
            color: "#fff",
            WebkitTextStroke: `${7 * u}px #000`,
            paintOrder: "stroke fill",
            textTransform: plan.captions.uppercase ? "uppercase" : "none",
          }}
        >
          {chunk.words.map((w, i) => {
            const active = plan.captions.preset === "karaoke" ? t >= w.start : w.emphasis;
            return (
              <span key={i} style={{ color: active ? plan.captions.highlightColor : "#fff", fontSize: w.emphasis ? fontSize * 1.15 : undefined }}>
                {w.text}
                {i < chunk.words.length - 1 ? " " : ""}
              </span>
            );
          })}
        </div>
      )}

      {flash > 0 && <AbsoluteFill style={{ background: "#fff", opacity: flash }} />}
    </AbsoluteFill>
  );
}
