/**
 * Mock backend used until the real API routes land (set NEXT_PUBLIC_UNFOLD_API=live to switch).
 * Builds 9 distinct AgentPlans from the sample fixtures and compiles them with the real compiler,
 * so everything the UI sees is a genuine EditPlan.
 */
import {
  compileEditPlan,
  sampleAgentPlans,
  sampleAnalysis,
  sampleLibrary,
  type AgentPlan,
  type EditPlan,
  type MediaAnalysis,
} from "@unfold/core";
import type { ApiStats } from "./types";

const MODEL = "kimi-k3.1-pro";
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const [chaos, story] = sampleAgentPlans;

function variantTemplates(): AgentPlan[] {
  const gaming: AgentPlan = {
    ...clone(chaos),
    title: "Gaming montage",
    style: "gaming-montage",
    rationale: "Hard cuts on the downbeat, glitch transitions and bold captions for a highlight-reel feel.",
    hookText: "THIS GAME IS BROKEN",
    captions: { ...chaos.captions, preset: "bold-pop", emphasisWords: ["plane", "highway", "insane"] },
    transitions: [
      { afterSegment: 0, type: "glitch" },
      { afterSegment: 1, type: "shake" },
      { afterSegment: 2, type: "glitch" },
    ],
  };
  const podcast: AgentPlan = {
    ...clone(story),
    title: "Podcast clip",
    style: "podcast-clip",
    rationale: "Talking-head pacing: trims dead air, clean lower captions, music ducked low.",
    hookText: "the craziest thing in this game",
    segments: [
      { srcStart: 0.3, srcEnd: 9.5, speed: 1.05 },
      { srcStart: 10.2, srcEnd: 19.8, speed: 1.05 },
    ],
    captions: { ...story.captions, preset: "clean-pop", wordsPerChunk: 3, uppercase: false, highlightColor: "#FFE14D" },
    music: { trackId: "sample-chill-90", volume: 0.15, alignDropToSrc: null, snapCutsToBeats: false },
    transitions: [{ afterSegment: 0, type: "cut" }],
    zooms: [{ srcTime: 4, kind: "slow-push", scale: 1.15 }],
    sfx: [],
  };
  const hook15: AgentPlan = {
    ...clone(chaos),
    title: "15s hook",
    rationale: "Shortest cut: the plane reveal first, reaction second, out before the scroll.",
    hookText: "WAIT FOR THE PLANE",
    segments: [
      { srcStart: 12.8, srcEnd: 16.5, speed: 1 },
      { srcStart: 2.1, srcEnd: 6.2, speed: 1.2 },
      { srcStart: 16.5, srcEnd: 19.8, speed: 1.1 },
    ],
    transitions: [
      { afterSegment: 0, type: "zoom-punch" },
      { afterSegment: 1, type: "flash" },
    ],
  };
  const karaoke: AgentPlan = {
    ...clone(story),
    title: "Karaoke captions",
    rationale: "Word-by-word karaoke captions carry the story; the beat drops on the landing.",
    captions: { ...story.captions, preset: "karaoke", wordsPerChunk: 4, position: "center", uppercase: true, highlightColor: "#FFE14D" },
    music: { trackId: "sample-hype-128", volume: 0.3, alignDropToSrc: 12.8, snapCutsToBeats: true },
    segments: [
      { srcStart: 0.3, srcEnd: 6.2, speed: 1.1 },
      { srcStart: 6.2, srcEnd: 12.8, speed: 1.1 },
      { srcStart: 12.8, srcEnd: 19.8, speed: 1 },
    ],
    transitions: [
      { afterSegment: 0, type: "slide" },
      { afterSegment: 1, type: "whip" },
    ],
  };
  const brainrot: AgentPlan = {
    ...clone(chaos),
    title: "Brainrot",
    rationale: "Maximum density: meme hits every two seconds, shake on every cut, caption on every word.",
    hookText: "BRO WHAT 💀",
    captions: { ...chaos.captions, wordsPerChunk: 1 },
    transitions: [
      { afterSegment: 0, type: "shake" },
      { afterSegment: 1, type: "flash" },
      { afterSegment: 2, type: "shake" },
    ],
    zooms: [
      { srcTime: 1.5, kind: "punch", scale: 1.35 },
      { srcTime: 8, kind: "punch", scale: 1.4 },
      { srcTime: 13.2, kind: "punch", scale: 1.5 },
      { srcTime: 17, kind: "punch", scale: 1.3 },
    ],
    sfx: [
      { srcTime: 1, sfxId: "whoosh", volume: 0.8 },
      { srcTime: 5, sfxId: "ding", volume: 0.7 },
      { srcTime: 9, sfxId: "record-scratch", volume: 0.8 },
      { srcTime: 12.9, sfxId: "boom", volume: 1 },
      { srcTime: 16.8, sfxId: "record-scratch", volume: 0.8 },
    ],
  };
  const slowBurn: AgentPlan = {
    ...clone(story),
    title: "Slow burn",
    rationale: "Builds tension with a long push-in and lets the reveal land with one boom.",
    hookText: null,
    zooms: [
      { srcTime: 2, kind: "slow-push", scale: 1.15 },
      { srcTime: 12.8, kind: "slow-push", scale: 1.3 },
    ],
    sfx: [{ srcTime: 12.9, sfxId: "boom", volume: 0.9 }],
  };
  const reaction: AgentPlan = {
    ...clone(chaos),
    title: "Reaction cut",
    rationale: "Leads with the reaction line, then rewinds to show what caused it.",
    hookText: "\"what is going on bro\"",
    segments: [
      { srcStart: 15.5, srcEnd: 19.8, speed: 1 },
      { srcStart: 0.3, srcEnd: 12.6, speed: 1.2 },
      { srcStart: 12.8, srcEnd: 15.5, speed: 1 },
    ],
    captions: { ...chaos.captions, preset: "bold-pop", position: "upper" },
    transitions: [
      { afterSegment: 0, type: "glitch" },
      { afterSegment: 1, type: "flash" },
    ],
    sfx: [{ srcTime: 12.9, sfxId: "boom", volume: 0.9 }, { srcTime: 15.6, sfxId: "ding", volume: 0.6 }],
  };
  return [clone(chaos), clone(story), gaming, podcast, hook15, karaoke, brainrot, slowBurn, reaction];
}

const STYLE_ORDER: Record<string, string[]> = {
  "gaming-montage": ["Gaming montage", "Chaos cut", "15s hook"],
  "podcast-clip": ["Podcast clip", "Storytime", "Karaoke captions"],
  storytime: ["Storytime", "Slow burn", "Karaoke captions"],
  chaos: ["Chaos cut", "Brainrot", "Reaction cut"],
};

export function mockAgentPlans(count: number, prompt = ""): AgentPlan[] {
  const all = variantTemplates();
  const key = Object.keys(STYLE_ORDER).find((k) => prompt.toLowerCase().includes(k.replace("-", " ")));
  const first = key ? STYLE_ORDER[key] : [];
  all.sort((a, b) => {
    const ia = first.indexOf(a.title);
    const ib = first.indexOf(b.title);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return all.slice(0, count);
}

export function fakeStats(tokens = 760 + Math.round(Math.random() * 420)): ApiStats {
  const tps = 1020 + Math.round(Math.random() * 180);
  const genMs = Math.round((tokens / tps) * 1000);
  const queueMs = 900 + Math.round(Math.random() * 400);
  return { queueMs, genMs, totalMs: queueMs + genMs, outputTokens: tokens, tps, model: MODEL };
}

// ---------- in-memory "server" ----------
type Stored = { agent: AgentPlan; analysis: MediaAnalysis };
const KEY = "unfold.mock.v1";
const db: Map<string, Stored> = new Map();
const analyses: Map<string, MediaAnalysis> = new Map([["sample", sampleAnalysis]]);

function load() {
  if (typeof window === "undefined" || db.size) return;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) for (const [k, v] of JSON.parse(raw) as [string, Stored][]) db.set(k, v);
  } catch {}
}
function save() {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify([...db.entries()]));
  } catch {}
}

export function mockRegisterUpload(file: File): string {
  const videoId = `up_${Date.now().toString(36)}`;
  analyses.set(videoId, { ...sampleAnalysis, videoId, src: URL.createObjectURL(file) });
  return videoId;
}

export function mockAnalysis(videoId: string): MediaAnalysis {
  return analyses.get(videoId) ?? sampleAnalysis;
}

export function mockCompile(id: string, agent: AgentPlan, analysis: MediaAnalysis): EditPlan {
  load();
  db.set(id, { agent, analysis });
  save();
  return compileEditPlan(agent, analysis, sampleLibrary, { id });
}

/** Rebuild a plan for a cold editor load (refresh, shared link). */
export function mockPlanById(id: string): EditPlan {
  load();
  const s = db.get(id);
  if (s) return compileEditPlan(s.agent, s.analysis, sampleLibrary, { id, stats: null });
  const idx = Math.abs([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % 9;
  return mockCompile(id, variantTemplates()[idx], sampleAnalysis);
}

/** Keyword remix: enough to make the chat feel real against sample data. */
export function mockRemix(id: string, message: string): { editPlan: EditPlan; reply: string } {
  load();
  const s = db.get(id) ?? { agent: variantTemplates()[0], analysis: sampleAnalysis };
  const a = clone(s.agent);
  const m = message.toLowerCase();
  const did: string[] = [];

  if (/fast|pac|quick|snapp/.test(m)) {
    a.segments = a.segments.map((x) => ({ ...x, speed: Math.min(2, Math.round((x.speed ?? 1) * 1.25 * 100) / 100) }));
    a.captions.wordsPerChunk = Math.max(1, a.captions.wordsPerChunk - 1);
    if (a.music) a.music.snapCutsToBeats = true;
    did.push("sped every clip up 25%", "snapped cuts to the beat");
  }
  if (/slow|calm|chill/.test(m)) {
    a.segments = a.segments.map((x) => ({ ...x, speed: Math.max(0.5, (x.speed ?? 1) * 0.85) }));
    a.music = { trackId: "sample-chill-90", volume: 0.25, alignDropToSrc: null, snapCutsToBeats: false };
    did.push("slowed the pacing", "switched to a chill track");
  }
  if (/less (meme|sfx|sound)|no (meme|sfx|sound)|fewer/.test(m)) {
    const before = a.sfx.length;
    a.sfx = /no /.test(m) ? [] : a.sfx.slice(0, Math.max(0, Math.floor(a.sfx.length / 2)));
    did.push(`cut meme sounds from ${before} to ${a.sfx.length}`);
  } else if (/more (meme|sfx|sound)|meme/.test(m)) {
    a.sfx = [...a.sfx, { srcTime: 3, sfxId: "whoosh", volume: 0.8 }, { srcTime: 8, sfxId: "ding", volume: 0.7 }];
    did.push("added 2 meme hits");
  }
  const secs = m.match(/(\d+)\s*s/);
  if (secs) {
    const target = Number(secs[1]);
    let total = 0;
    const kept: AgentPlan["segments"] = [];
    for (const seg of a.segments) {
      const sp = seg.speed ?? 1;
      const len = (seg.srcEnd - seg.srcStart) / sp;
      if (total + len <= target) {
        kept.push(seg);
        total += len;
      } else {
        const rest = target - total;
        if (rest > 0.5) kept.push({ ...seg, srcEnd: seg.srcStart + rest * sp });
        break;
      }
    }
    a.segments = kept.length ? kept : [a.segments[0]];
    a.transitions = a.transitions.filter((t) => t.afterSegment < a.segments.length - 1);
    did.push(`trimmed to ${target}s`);
  }
  if (/no caption|remove caption|hide caption/.test(m)) {
    a.captions.enabled = false;
    did.push("turned captions off");
  } else if (/caption/.test(m)) {
    a.captions.preset = a.captions.preset === "meme" ? "bold-pop" : "meme";
    a.captions.uppercase = true;
    did.push(`switched captions to ${a.captions.preset}`);
  }
  if (/zoom|punch/.test(m)) {
    a.zooms = [...a.zooms, { srcTime: 6.5, kind: "punch", scale: 1.4 }, { srcTime: 10, kind: "punch", scale: 1.3 }];
    did.push("added 2 zoom punches");
  }
  if (/hype|energy|music|beat/.test(m) && !/chill/.test(m)) {
    a.music = { trackId: "sample-hype-128", volume: 0.4, alignDropToSrc: 12.8, snapCutsToBeats: true };
    did.push("put the hype track's drop on the plane");
  }
  if (/hook/.test(m)) {
    a.hookText = "YOU WON'T BELIEVE THIS";
    did.push("rewrote the hook");
  }
  if (!did.length) {
    a.transitions = a.transitions.map((t) => ({ ...t, type: t.type === "flash" ? "whip" : "flash" }));
    a.captions.highlightColor = a.captions.highlightColor === "#FFE14D" ? "#FF5A1F" : "#FFE14D";
    did.push("swapped transition styles", "changed the caption highlight");
  }

  const editPlan = mockCompile(id, a, s.analysis);
  const reply = did.length === 1 ? `Done: ${did[0]}.` : `Done: ${did.slice(0, -1).join(", ")} and ${did[did.length - 1]}.`;
  return { editPlan, reply: reply.charAt(0).toUpperCase() + reply.slice(1) };
}
