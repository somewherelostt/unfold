"use client";
/**
 * Client state for the product UI. Tiny external store (useSyncExternalStore), persisted to sessionStorage.
 * Edits are kept client-side, keyed by plan id: `base` is the agent's plan, `overrides` are manual edits,
 * `past`/`future` give undo/redo across both.
 */
import { useSyncExternalStore } from "react";
import { ASPECT_SIZE, sampleLibrary, type EditPlan, type Library, type MediaAnalysis } from "@unfold/core";
import * as api from "./api";
import type { ApiStats, ChatMsg, Overrides, StyleChoice } from "./types";
import { STYLE_LABEL } from "./styles";

type Snap = { base: EditPlan; overrides: Overrides; serverId: string };
export type PlanEntry = Snap & { past: Snap[]; future: Snap[]; chat: ChatMsg[]; name: string; stats?: ApiStats; direction?: string };

export type RunStatus = "idle" | "preparing" | "queued" | "generating" | "done" | "error";
export type Run = {
  status: RunStatus;
  phase?: string; // human label for preparing steps
  startedAt: number;
  queuedAt?: number; // /api/variants accepted
  firstAt?: number; // first variant landed
  doneAt?: number;
  slots: (string | null)[]; // plan ids by variant index
  slotErrors: (string | null)[];
  summary?: { count: number; ok: number; wallMs: number; outputTokens: number; avgTps: number };
  warning?: string;
  error?: string;
};

export type State = {
  project: {
    videoId: string | null;
    fileName: string | null;
    analysis: MediaAnalysis | null;
    prompt: string;
    style: StyleChoice | null;
    referenceUrl: string;
    analyzing: boolean;
    analyzeError: string | null;
  };
  run: Run;
  plans: Record<string, PlanEntry>;
  library: Library;
};

const KEY = "unfold.app.v2";
const initial: State = {
  project: { videoId: null, fileName: null, analysis: null, prompt: "", style: null, referenceUrl: "", analyzing: false, analyzeError: null },
  run: { status: "idle", startedAt: 0, slots: [], slotErrors: [] },
  plans: {},
  library: sampleLibrary,
};

let state: State = initial;
let loaded = false;
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as State;
      // A run interrupted by a reload can't resume; keep whatever finished.
      if (!["idle", "done", "error"].includes(saved.run.status)) saved.run.status = saved.run.slots?.some(Boolean) ? "done" : "idle";
      saved.run.slotErrors ??= [];
      saved.project.analyzing = false;
      // Blob URLs don't survive reloads.
      if (saved.project.analysis?.src.startsWith("blob:")) saved.project = { ...saved.project, analysis: null, videoId: null, fileName: null };
      state = { ...initial, ...saved, library: saved.library ?? sampleLibrary };
    }
  } catch {}
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function set(fn: (s: State) => State) {
  ensureLoaded();
  state = fn(state);
  listeners.forEach((l) => l());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }, 200);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const getSnapshot = () => {
  ensureLoaded();
  return state;
};
const getServerSnapshot = () => initial;

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(getSnapshot()), () => sel(getServerSnapshot()));
}
export const getState = getSnapshot;

// ---------- derived ----------
export function applyOverrides(base: EditPlan, o: Overrides, lib: Library): EditPlan {
  const p: EditPlan = { ...base, captions: { ...base.captions } };
  if (o.captions !== undefined) p.captions.enabled = o.captions;
  if (o.captionPreset) p.captions.preset = o.captionPreset;
  if (o.music === false) p.music = null;
  else if (base.music) {
    let m = { ...base.music };
    if (o.trackId && o.trackId !== m.trackId) {
      const t = lib.music.find((x) => x.id === o.trackId);
      if (t) {
        const trackStart = t.downbeats[0] ?? t.beats[0] ?? 0;
        m = {
          ...m,
          trackId: t.id,
          url: t.url,
          title: t.title,
          bpm: t.bpm,
          trackStart,
          beats: t.beats.map((b) => b - trackStart).filter((b) => b >= 0 && b <= base.durationSec),
        };
      }
    }
    if (o.volume !== undefined) m.volume = o.volume;
    p.music = m;
  }
  if (o.sfx === false) p.sfx = [];
  if (o.transitions === false) p.transitions = [];
  if (o.zooms === false) p.zooms = [];
  if (o.aspect && o.aspect !== base.aspect) {
    p.aspect = o.aspect;
    p.width = ASPECT_SIZE[o.aspect].width;
    p.height = ASPECT_SIZE[o.aspect].height;
  }
  return p;
}

export function usePlan(id: string): { entry: PlanEntry | undefined; plan: EditPlan | undefined } {
  const entry = useStore((s) => s.plans[id]);
  const lib = useStore((s) => s.library);
  return { entry, plan: entry ? memoApply(entry, lib) : undefined };
}
type Key = { base: EditPlan; overrides: Overrides };
const applied = new WeakMap<Key, EditPlan>();
function memoApply(e: PlanEntry, lib: Library) {
  // Cache by (base, overrides) identity via a synthetic key object stored on the entry.
  const k = keyFor(e.base, e.overrides);
  let v = applied.get(k);
  if (!v) {
    v = applyOverrides(e.base, e.overrides, lib);
    applied.set(k, v);
  }
  return v;
}
const keys = new WeakMap<EditPlan, WeakMap<Overrides, Key>>();
function keyFor(base: EditPlan, overrides: Overrides): Key {
  let inner = keys.get(base);
  if (!inner) keys.set(base, (inner = new WeakMap()));
  let k = inner.get(overrides);
  if (!k) inner.set(overrides, (k = { base, overrides }));
  return k;
}

// ---------- actions ----------
const uid = () => Math.random().toString(36).slice(2, 10);

export const actions = {
  setPrompt(prompt: string) {
    set((s) => ({ ...s, project: { ...s.project, prompt } }));
  },
  setStyle(style: StyleChoice | null) {
    set((s) => ({ ...s, project: { ...s.project, style } }));
  },
  setReferenceUrl(referenceUrl: string) {
    set((s) => ({ ...s, project: { ...s.project, referenceUrl } }));
  },

  async upload(file: File) {
    set((s) => ({ ...s, project: { ...s.project, fileName: file.name, videoId: null, analysis: null, analyzing: true, analyzeError: null } }));
    analysisJob = (async () => {
      const { videoId } = await api.uploadVideo(file);
      set((s) => ({ ...s, project: { ...s.project, videoId } }));
      const analysis = await api.analyze(videoId);
      set((s) => ({ ...s, project: { ...s.project, analysis, analyzing: false } }));
      return analysis;
    })();
    try {
      await analysisJob;
    } catch (e) {
      set((s) => ({ ...s, project: { ...s.project, analyzing: false, analyzeError: errMsg(e) } }));
    }
  },
  clearUpload() {
    analysisJob = null;
    set((s) => ({ ...s, project: { ...s.project, fileName: null, videoId: null, analysis: null, analyzing: false, analyzeError: null } }));
  },
  /** Inspiration file (fallback when a link can't be fetched). Not persisted. */
  setReferenceFile(file: File | null) {
    referenceFile = file;
    set((s) => ({ ...s, project: { ...s.project, referenceUrl: file ? `upload:${file.name}` : "" } }));
  },

  async loadLibrary() {
    try {
      const library = await api.getLibrary();
      set((s) => ({ ...s, library }));
    } catch {}
  },

  /** Kick off a variant run. Lives outside components so navigation doesn't cancel it. */
  async generate(count = 9) {
    if (["preparing", "queued", "generating"].includes(state.run.status)) return;
    const p = state.project;
    const setRun = (patch: Partial<Run>) => set((s) => ({ ...s, run: { ...s.run, ...patch } }));
    set((s) => ({
      ...s,
      run: { status: "preparing", phase: "Reading your clip", startedAt: Date.now(), slots: Array(count).fill(null), slotErrors: Array(count).fill(null) },
    }));
    try {
      // 1. Analysis (uploads analyse in the background; "sample" is the built-in demo).
      let videoId = p.videoId ?? "sample";
      if (p.fileName && analysisJob) videoId = (await analysisJob).videoId;
      if (!state.project.analysis || state.project.analysis.videoId !== videoId) {
        const analysis = await api.analyze(videoId);
        set((s) => ({ ...s, project: { ...s.project, analysis, videoId: s.project.videoId ?? (p.fileName ? videoId : null) } }));
      }

      // 2. Inspiration video → style profile.
      let styleId: string | undefined;
      const link = p.style?.kind === "link" ? p.style.url : p.referenceUrl && !p.referenceUrl.startsWith("upload:") ? p.referenceUrl : "";
      const file = p.style?.kind === "file" || p.referenceUrl.startsWith("upload:") ? referenceFile : null;
      if (link || file) {
        setRun({ phase: "Watching your inspiration video" });
        try {
          styleId = (await api.reference(file ? { file } : { url: link })).styleId;
        } catch (e) {
          setRun({ warning: `Couldn't copy that style (${errMsg(e)}). Going without it.` });
        }
      }

      // 3. Prompt: preset styles travel as a hint in the prompt.
      const hint = p.style?.kind === "preset" ? `Style: ${STYLE_LABEL[p.style.preset]}.` : "";
      const prompt = [p.prompt.trim(), hint].filter(Boolean).join("\n");

      setRun({ phase: "Sending to Cerebras" });
      for await (const ev of api.generateVariants({ videoId, prompt, styleId, count })) {
        if (ev.type === "start") setRun({ status: "queued", queuedAt: Date.now(), phase: undefined });
        else if (ev.type === "variant") {
          const { index, editPlan, stats, direction } = ev;
          set((s) => {
            const slots = [...s.run.slots];
            slots[index] = editPlan.id;
            return {
              ...s,
              run: { ...s.run, status: "generating", slots, firstAt: s.run.firstAt ?? Date.now() },
              plans: { ...s.plans, [editPlan.id]: newEntry(editPlan, stats, direction) },
            };
          });
        } else if (ev.type === "variant-error") {
          set((s) => {
            const slotErrors = [...s.run.slotErrors];
            slotErrors[ev.index] = ev.message;
            return { ...s, run: { ...s.run, slotErrors } };
          });
        } else if (ev.type === "summary") setRun({ summary: ev });
        else if (ev.type === "error") throw new Error(ev.message);
      }
      const ok = state.run.slots.some(Boolean);
      setRun(ok ? { status: "done", doneAt: Date.now() } : { status: "error", error: state.run.slotErrors.find(Boolean) ?? "No edits came back" });
    } catch (e) {
      setRun(state.run.slots.some(Boolean) ? { status: "done", doneAt: Date.now(), warning: errMsg(e) } : { status: "error", error: errMsg(e) });
    }
  },

  async ensurePlan(id: string) {
    if (state.plans[id]) return;
    const { editPlan } = await api.getPlan(id);
    set((s) => ({ ...s, plans: { ...s.plans, [id]: newEntry(editPlan) } }));
  },

  rename(id: string, name: string) {
    set((s) => (s.plans[id] ? { ...s, plans: { ...s.plans, [id]: { ...s.plans[id], name } } } : s));
  },

  /** Manual edit from the decisions panel. */
  override(id: string, patch: Overrides) {
    commit(id, (e) => ({ base: e.base, overrides: { ...e.overrides, ...patch }, serverId: e.serverId }));
  },

  undo(id: string) {
    set((s) => {
      const e = s.plans[id];
      if (!e?.past.length) return s;
      const prev = e.past[e.past.length - 1];
      return {
        ...s,
        plans: { ...s.plans, [id]: { ...e, ...prev, past: e.past.slice(0, -1), future: [snap(e), ...e.future] } },
      };
    });
  },
  redo(id: string) {
    set((s) => {
      const e = s.plans[id];
      if (!e?.future.length) return s;
      const [next, ...rest] = e.future;
      return {
        ...s,
        plans: { ...s.plans, [id]: { ...e, ...next, future: rest, past: [...e.past, snap(e)] } },
      };
    });
  },

  async remix(id: string, message: string) {
    const e = state.plans[id];
    if (!e) return;
    const agentId = uid();
    pushChat(id, { id: uid(), role: "user", text: message }, { id: agentId, role: "agent", text: "", pending: true, draft: "" });
    let draft = "";
    try {
      let got = false;
      for await (const ev of api.remix({ planId: e.serverId, message })) {
        if (ev.type === "delta") {
          draft += ev.text;
          updateChat(id, agentId, { draft });
        } else if (ev.type === "plan") {
          got = true;
          // The agent re-plans from the server copy; manual overrides reset (undo brings them back).
          commit(id, () => ({ base: ev.editPlan, overrides: {}, serverId: ev.editPlan.id }));
          set((s) => ({ ...s, plans: { ...s.plans, [id]: { ...s.plans[id], stats: ev.stats } } }));
          updateChat(id, agentId, { text: ev.reply ?? `Done. ${ev.editPlan.rationale}`, stats: ev.stats, pending: false, draft: undefined });
        } else if (ev.type === "error") throw new Error(ev.message);
      }
      if (!got) updateChat(id, agentId, { text: "No changes came back.", pending: false });
    } catch (err) {
      updateChat(id, agentId, { text: `Couldn't remix: ${errMsg(err)}`, pending: false });
    }
  },
};

let analysisJob: Promise<MediaAnalysis> | null = null;
let referenceFile: File | null = null;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const snap = (e: Snap): Snap => ({ base: e.base, overrides: e.overrides, serverId: e.serverId });
function newEntry(editPlan: EditPlan, stats?: ApiStats, direction?: string): PlanEntry {
  return { base: editPlan, overrides: {}, serverId: editPlan.id, past: [], future: [], chat: [], name: editPlan.title, stats, direction };
}

function commit(id: string, fn: (e: PlanEntry) => Snap) {
  set((s) => {
    const e = s.plans[id];
    if (!e) return s;
    const next = fn(e);
    return {
      ...s,
      plans: { ...s.plans, [id]: { ...e, ...next, past: [...e.past, snap(e)].slice(-50), future: [] } },
    };
  });
}
function pushChat(id: string, ...msgs: ChatMsg[]) {
  set((s) => (s.plans[id] ? { ...s, plans: { ...s.plans, [id]: { ...s.plans[id], chat: [...s.plans[id].chat, ...msgs] } } } : s));
}
function updateChat(id: string, msgId: string, patch: Partial<Extract<ChatMsg, { role: "agent" }>>) {
  set((s) => {
    const e = s.plans[id];
    if (!e) return s;
    return {
      ...s,
      plans: {
        ...s.plans,
        [id]: { ...e, chat: e.chat.map((m) => (m.id === msgId && m.role === "agent" ? { ...m, ...patch } : m)) },
      },
    };
  });
}

export type { ApiStats };
