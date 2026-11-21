import {
  ASPECT_SIZE,
  type AgentPlan,
  type EditPlan,
  type MediaAnalysis,
  type MusicTrack,
  type SfxItem,
  type TransitionType,
} from "./schema";

export type Library = { music: MusicTrack[]; sfx: SfxItem[] };

const TRANSITION_SEC: Record<TransitionType, number> = {
  cut: 0,
  whip: 0.25,
  "zoom-punch": 0.3,
  flash: 0.15,
  shake: 0.3,
  glitch: 0.25,
  slide: 0.3,
};

const MIN_CLIP_SEC = 0.3;
const round = (n: number) => Math.round(n * 1000) / 1000;
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

type Clip = EditPlan["clips"][number];

function layoutClips(segments: { srcStart: number; srcEnd: number; speed: number }[]): Clip[] {
  let t = 0;
  return segments.map((s, i) => {
    const dur = (s.srcEnd - s.srcStart) / s.speed;
    const clip = { id: `c${i}`, start: round(t), end: round(t + dur), srcStart: s.srcStart, srcEnd: s.srcEnd, speed: s.speed };
    t += dur;
    return clip;
  });
}

/** Map a source-time moment to output time; null if that moment was cut. */
export function mapSrcToOut(clips: Clip[], srcT: number): number | null {
  for (const c of clips) {
    if (srcT >= c.srcStart && srcT <= c.srcEnd) return round(c.start + (srcT - c.srcStart) / c.speed);
  }
  return null;
}

/** Nearest kept moment for a source time (so a cue on a cut moment lands on the closest kept frame). */
function mapSrcToOutNearest(clips: Clip[], srcT: number): number {
  const exact = mapSrcToOut(clips, srcT);
  if (exact !== null) return exact;
  let best = 0;
  let bestDist = Infinity;
  for (const c of clips) {
    const candidates: [number, number][] = [
      [c.srcStart, c.start],
      [c.srcEnd, c.end],
    ];
    for (const [s, o] of candidates) {
      const d = Math.abs(s - srcT);
      if (d < bestDist) {
        bestDist = d;
        best = o;
      }
    }
  }
  return best;
}

export function compileEditPlan(
  plan: AgentPlan,
  analysis: MediaAnalysis,
  library: Library,
  opts: { id: string; stats?: EditPlan["stats"] } = { id: "plan" },
): EditPlan {
  const srcDur = analysis.durationSec;

  // 1. Sanitize segments.
  const segments = plan.segments
    .map((s) => ({
      srcStart: Math.max(0, Math.min(s.srcStart, srcDur)),
      srcEnd: Math.max(0, Math.min(s.srcEnd, srcDur)),
      speed: s.speed ?? 1,
    }))
    .filter((s) => s.srcEnd - s.srcStart >= MIN_CLIP_SEC);
  if (segments.length === 0) segments.push({ srcStart: 0, srcEnd: srcDur, speed: 1 });

  let clips = layoutClips(segments);

  // 2. Music placement and beat snapping.
  const track = plan.music ? library.music.find((m) => m.id === plan.music!.trackId) ?? null : null;
  let trackStart = 0;
  if (track && plan.music) {
    const dropOut = plan.music.alignDropToSrc != null ? mapSrcToOut(clips, plan.music.alignDropToSrc) : null;
    if (dropOut != null && track.dropAt != null) trackStart = Math.max(0, track.dropAt - dropOut);
    else trackStart = track.downbeats[0] ?? track.beats[0] ?? 0;

    if (plan.music.snapCutsToBeats && track.beats.length > 0) {
      for (let i = 0; i < segments.length - 1; i++) {
        clips = layoutClips(segments);
        const end = clips[i].end;
        const outBeats = track.beats.map((b) => b - trackStart);
        let nearest = outBeats[0];
        for (const b of outBeats) if (Math.abs(b - end) < Math.abs(nearest - end)) nearest = b;
        const delta = nearest - end;
        const clipLen = clips[i].end - clips[i].start;
        if (Math.abs(delta) <= Math.min(0.5, clipLen * 0.35)) {
          const s = segments[i];
          const newEnd = Math.min(srcDur, s.srcEnd + delta * s.speed);
          if (newEnd - s.srcStart >= MIN_CLIP_SEC) s.srcEnd = newEnd;
        }
      }
      clips = layoutClips(segments);
    }
  }

  const durationSec = clips.length ? clips[clips.length - 1].end : 0;
  const clampOut = (t: number) => Math.max(0, Math.min(durationSec, t));

  // 3. Captions: words that survive the cut, mapped to output time, grouped into chunks.
  const emphasis = new Set(plan.captions.emphasisWords.map(norm));
  const kept: { text: string; start: number; end: number; emphasis: boolean; clip: string }[] = [];
  for (const w of analysis.words) {
    const mid = (w.start + w.end) / 2;
    const clip = clips.find((c) => mid >= c.srcStart && mid <= c.srcEnd);
    if (!clip) continue;
    const s = clip.start + (Math.max(w.start, clip.srcStart) - clip.srcStart) / clip.speed;
    const e = clip.start + (Math.min(w.end, clip.srcEnd) - clip.srcStart) / clip.speed;
    kept.push({ text: w.text.trim(), start: round(s), end: round(e), emphasis: emphasis.has(norm(w.text)), clip: clip.id });
  }
  const chunks: EditPlan["captions"]["chunks"] = [];
  let cur: typeof kept = [];
  const flush = () => {
    if (!cur.length) return;
    chunks.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      words: cur.map(({ text, start, end, emphasis }) => ({ text, start, end, emphasis })),
    });
    cur = [];
  };
  for (const w of kept) {
    const prev = cur[cur.length - 1];
    const breakHere =
      cur.length >= plan.captions.wordsPerChunk || (prev && (prev.clip !== w.clip || w.start - prev.end > 0.6)) || /[.!?]$/.test(prev?.text ?? "");
    if (breakHere) flush();
    cur.push(w);
  }
  flush();

  // 4. Cues.
  const transitions = plan.transitions
    .filter((t) => t.afterSegment >= 0 && t.afterSegment < clips.length - 1)
    .map((t) => ({ at: clips[t.afterSegment].end, type: t.type, durationSec: TRANSITION_SEC[t.type] }));

  const zooms = plan.zooms.map((z) => {
    const start = mapSrcToOutNearest(clips, z.srcTime);
    const len = z.kind === "punch" ? 0.6 : 2.5;
    return { start, end: clampOut(start + len), scale: z.scale, kind: z.kind };
  });

  const sfx = plan.sfx.flatMap((s) => {
    const item = library.sfx.find((x) => x.id === s.sfxId);
    if (!item) return [];
    return [{ at: mapSrcToOutNearest(clips, s.srcTime), sfxId: item.id, url: item.url, name: item.name, volume: s.volume }];
  });

  const overlays = plan.overlays.map((o) => {
    const start = mapSrcToOutNearest(clips, o.srcTime);
    return { start, end: clampOut(start + o.durationSec), text: o.text };
  });

  const { width, height } = ASPECT_SIZE[plan.aspect];

  return {
    version: 1,
    id: opts.id,
    title: plan.title,
    style: plan.style,
    rationale: plan.rationale,
    aspect: plan.aspect,
    fps: 30,
    width,
    height,
    durationSec: round(durationSec),
    source: { videoId: analysis.videoId, src: analysis.src, width: analysis.width, height: analysis.height },
    hookText: plan.hookText,
    clips,
    captions: {
      enabled: plan.captions.enabled,
      preset: plan.captions.preset,
      position: plan.captions.position,
      uppercase: plan.captions.uppercase,
      highlightColor: plan.captions.highlightColor,
      chunks,
    },
    music:
      track && plan.music
        ? {
            trackId: track.id,
            url: track.url,
            title: track.title,
            bpm: track.bpm,
            trackStart: round(trackStart),
            volume: plan.music.volume,
            beats: track.beats.map((b) => round(b - trackStart)).filter((b) => b >= 0 && b <= durationSec),
          }
        : null,
    transitions,
    zooms,
    sfx,
    overlays,
    stats: opts.stats ?? null,
  };
}
