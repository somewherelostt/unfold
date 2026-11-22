"use client";
/**
 * Client state for the product UI. Tiny external store (useSyncExternalStore), persisted to sessionStorage.
 * Edits are kept client-side, keyed by plan id: `base` is the agent's plan, `overrides` are manual edits,
 * `past`/`future` give undo/redo across both.
 */
import { useSyncExternalStore } from "react";
import { ASPECT_SIZE, sampleLibrary, type EditPlan, type Library, type MediaAnalysis } from "@unfold/core";
import * as api from "./api";
import type { ApiStats, ChatMsg, ExportJob, ExportReview, GenerateRequest, Overrides, StyleChoice, SupportingUpload } from "./types";
import { STYLE_LABEL } from "./styles";
import { planSteps, planSummary } from "./narrate";
import { mergeSupporting } from "./broll";
import { planKey } from "./plan-key";

type Snap = { base: EditPlan; overrides: Overrides; serverId: string };
type SavedVersion = { savedPlan: EditPlan; revision?: number; updatedAt?: number };
export type PlanEntry = Snap & { past: Snap[]; future: Snap[]; chat: ChatMsg[]; name: string; stats?: ApiStats; direction?: string; request?: Omit<GenerateRequest, "count">;
  revision?: number; updatedAt?: number; savedPlan?: EditPlan; save?: { status: "saving" | "saved" | "error" | "conflict"; message?: string };
};

export type RunStatus = "idle" | "preparing" | "queued" | "generating" | "done" | "error" | "cancelled";
export const isActive = (r?: Run) => !!r && ["preparing", "queued", "generating"].includes(r.status);
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
  /** Past-tense prep steps for the generating chat (ms since start). */
  log?: { at: number; text: string }[];
};

export type State = {
  project: {
    videoId: string | null;
    fileName: string | null;
    analysis: MediaAnalysis | null;
    prompt: string;
    promptStyle?: string;
    style: StyleChoice | null;
    referenceUrl: string;
    referenceNotice?: string | null;
    aspect: "9:16" | "1:1" | "16:9";
    analyzing: boolean;
    analyzeError: string | null;
  };
  run: Run; // the main edit (count=1)
  alts: Record<string, Run>; // alternate versions, keyed by the root plan id
  altRoot: Record<string, string>; // planId → root plan id of its alternates group
  planErrors: Record<string, string>; // cold-load failures for /app/edit/[id]
  planAccess: Record<string, "checking" | "ready" | "error">;
  plans: Record<string, PlanEntry>;
  analyses: Record<string, MediaAnalysis>; // by videoId (timeline thumbnails on cold loads)
  supporting: Record<string, SupportingUpload[]>; // inventory belongs to its primary source
  supportingErrors: Record<string, string>;
  reviews: Record<string, ExportReview>;
  savedVersions: Record<string, SavedVersion>;
  exportJobs: Record<string, ExportJob>;
  library: Library;
};

const KEY = "unfold.app.v4";
const initial: State = {
  project: { videoId: null, fileName: null, analysis: null, prompt: "", style: null, referenceUrl: "", aspect: "9:16", analyzing: false, analyzeError: null },
  run: { status: "idle", startedAt: 0, slots: [], slotErrors: [] },
  alts: {},
  altRoot: {},
  planErrors: {},
  planAccess: {},
  plans: {},
  analyses: {},
  supporting: {},
  supportingErrors: {},
  reviews: {},
  savedVersions: {},
  exportJobs: {},
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
      const settle = (r: Run) => (isActive(r) ? { ...r, status: (r.slots?.some(Boolean) ? "done" : "cancelled") as RunStatus, error: r.slots?.some(Boolean) ? undefined : "Interrupted by a reload." } : r);
      saved.run = settle(saved.run);
      saved.alts = Object.fromEntries(Object.entries(saved.alts ?? {}).map(([k, r]) => [k, settle(r)]));
      saved.planErrors = {};
      saved.planAccess = {};
      saved.run.slotErrors ??= [];
      saved.project.analyzing = false;
      saved.supporting = Object.fromEntries(Object.entries(saved.supporting ?? {}).map(([id, items]) => [id, items.map((item) =>
        ["uploading", "analyzing"].includes(item.status) ? { ...item, status: "error" as const, error: "Interrupted by a reload. Choose this file again to retry." } : item)]));
      if (saved.project.referenceUrl.startsWith("upload:")) {
        saved.project.referenceUrl = "";
        saved.project.referenceNotice = "Attach your inspiration video again after reloading.";
        if (saved.project.style?.kind === "file") saved.project.style = null;
      }
      // In-flight remixes die with the page; don't leave them spinning.
      for (const e of Object.values(saved.plans ?? {})) {
        e.chat = e.chat.map((m) => (m.role === "agent" && m.pending ? { ...m, pending: false, draft: undefined, text: "Interrupted by a reload. Send it again." } : m));
        if (e.save?.status === "saving") e.save = { status: "error", message: "The save was interrupted. Check the saved edit before trying again." };
      }
      // Blob URLs don't survive reloads.
      if (saved.project.analysis?.src.startsWith("blob:")) saved.project = { ...saved.project, analysis: null, videoId: null, fileName: null };
      state = { ...initial, ...saved, analyses: saved.analyses ?? {}, altRoot: saved.altRoot ?? {}, library: saved.library ?? sampleLibrary };
    }
  } catch {}
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function writeState() {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}

/** Flush a navigation handoff before removing its URL or attached-file recovery copy. */
export function persistState() {
  ensureLoaded();
  clearTimeout(saveTimer);
  return writeState();
}

function set(fn: (s: State) => State) {
  ensureLoaded();
  state = fn(state);
  listeners.forEach((l) => l());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeState, 200);
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
  if (o.supporting) p.supporting = o.supporting;
  if (o.broll || o.brollDisabled) p.broll = (o.broll ?? base.broll ?? []).filter((b) => !o.brollDisabled?.includes(b.id));
  if (o.broll || o.brollDisabled || o.supporting) delete p.quality;
  if (o.captions !== undefined) p.captions.enabled = o.captions;
  if (o.captionPreset) {
    p.captions.preset = o.captionPreset;
    delete p.captions.design;
  }
  if (o.captionDesign) p.captions.design = o.captionDesign;
  if (o.captionPosition) p.captions.position = o.captionPosition;
  if (o.uppercase !== undefined) p.captions.uppercase = o.uppercase;
  if (o.highlightColor) p.captions.highlightColor = o.highlightColor;
  if (o.wordsPerLine) p.captions.chunks = rechunk(base.captions.chunks, o.wordsPerLine);
  if (o.hookText !== undefined) p.hookText = o.hookText;
  if (o.music === false) p.music = null;
  else if (base.music || o.music === true || o.trackId) {
    let m = base.music ? { ...base.music } : null;
    if (!m || (o.trackId && o.trackId !== m.trackId)) {
      const t = lib.music.find((x) => x.id === o.trackId) ?? (!m ? lib.music[0] : undefined);
      if (t) {
        const trackStart = t.downbeats[0] ?? t.beats[0] ?? 0;
        m = {
          trackId: t.id,
          url: t.url,
          title: t.title,
          bpm: t.bpm,
          trackStart,
          volume: m?.volume ?? 0.3,
          beats: t.beats.map((b) => b - trackStart).filter((b) => b >= 0 && b <= base.durationSec),
        };
      }
    }
    if (m && o.volume !== undefined) m.volume = o.volume;
    p.music = m;
  }
  if (o.sfx === false) p.sfx = [];
  else if (o.sfxAdded?.length || o.sfxRemoved?.length)
    p.sfx = [...base.sfx.filter((_, i) => !o.sfxRemoved?.includes(i)), ...(o.sfxAdded ?? [])].sort((x, y) => x.at - y.at);
  if (o.transitions === false) p.transitions = [];
  else if (o.transitions === true || (o.transitionTypes && Object.keys(o.transitionTypes).length))
    p.transitions = transitionPoints(base).map((t, i) => {
      const type = o.transitionTypes?.[i] ?? t.type;
      return { ...t, type, durationSec: TRANSITION_SEC[type] };
    }).filter((t) => t.type !== "cut");
  if (o.zooms === false) p.zooms = [];
  else if (o.zooms === true && !base.zooms.length)
    p.zooms = base.clips.slice(0, 4).map((c) => ({ start: c.start, end: Math.min(c.end, c.start + 0.35), scale: 1.2, kind: "punch" as const }));
  if (o.aspect && o.aspect !== base.aspect) {
    p.aspect = o.aspect;
    p.width = ASPECT_SIZE[o.aspect].width;
    p.height = ASPECT_SIZE[o.aspect].height;
  }
  return p;
}

const TRANSITION_SEC = { cut: 0, whip: 0.18, "zoom-punch": 0.22, flash: 0.12, shake: 0.2, glitch: 0.18, slide: 0.25 } as const;
export function transitionPoints(base: EditPlan): EditPlan["transitions"] {
  return base.clips.slice(1).map((c) => base.transitions.find((t) => Math.abs(t.at - c.start) < 0.05) ?? { at: c.start, type: "whip", durationSec: TRANSITION_SEC.whip });
}

/** Regroup caption words into `n`-word lines (breaking on pauses and sentence ends). */
function rechunk(chunks: EditPlan["captions"]["chunks"], n: number): EditPlan["captions"]["chunks"] {
  const words = chunks.flatMap((c) => c.words);
  const out: EditPlan["captions"]["chunks"] = [];
  let cur: typeof words = [];
  const flush = () => {
    if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (cur.length >= n || (prev && (w.start - prev.end > 0.6 || /[.!?]$/.test(prev.text)))) flush();
    cur.push(w);
  }
  flush();
  return out;
}

/** Human-readable list of what changed between two plans (remix change cards). */
export function planDiff(a: EditPlan, b: EditPlan): string[] {
  const out: string[] = [];
  if (JSON.stringify(a.broll ?? []) !== JSON.stringify(b.broll ?? [])) out.push(`${b.broll?.length ?? 0} supporting shots in the edit`);
  const avg = (p: EditPlan) => p.clips.reduce((x, c) => x + c.speed * (c.end - c.start), 0) / Math.max(0.01, p.durationSec);
  const r = avg(b) / Math.max(0.01, avg(a));
  if (r > 1.05) out.push(`Cuts ${r.toFixed(1)}× faster`);
  if (r < 0.95) out.push(`Cuts ${(1 / r).toFixed(1)}× slower`);
  if (Math.abs(b.durationSec - a.durationSec) > 0.4) out.push(`Length ${a.durationSec.toFixed(1)}s → ${b.durationSec.toFixed(1)}s`);
  if (b.clips.length !== a.clips.length) out.push(`${b.clips.length} clips (was ${a.clips.length})`);
  const ds = b.sfx.length - a.sfx.length;
  if (ds) out.push(`${Math.abs(ds)} sound effect${Math.abs(ds) === 1 ? "" : "s"} ${ds < 0 ? "removed" : "added"}`);
  if (b.captions.preset !== a.captions.preset) out.push(`Captions → ${b.captions.preset.replace("-", " ")}`);
  if (b.captions.enabled !== a.captions.enabled) out.push(b.captions.enabled ? "Captions on" : "Captions off");
  if ((b.music?.trackId ?? "") !== (a.music?.trackId ?? "")) out.push(b.music ? `Music → ${b.music.title}` : "Music removed");
  const dt = b.transitions.length - a.transitions.length;
  if (dt) out.push(`${Math.abs(dt)} transition${Math.abs(dt) === 1 ? "" : "s"} ${dt < 0 ? "removed" : "added"}`);
  const dz = b.zooms.length - a.zooms.length;
  if (dz) out.push(`${Math.abs(dz)} zoom${Math.abs(dz) === 1 ? "" : "s"} ${dz < 0 ? "removed" : "added"}`);
  if ((b.hookText ?? "") !== (a.hookText ?? "")) out.push(b.hookText ? `New hook: “${b.hookText}”` : "Hook text removed");
  return out;
}

export function usePlan(id: string): { entry: PlanEntry | undefined; plan: EditPlan | undefined } {
  const entry = useStore((s) => s.plans[id]);
  const lib = useStore((s) => s.library);
  return { entry, plan: entry ? memoApply(entry, lib) : undefined };
}
type Key = { base: EditPlan; overrides: Overrides };
const applied = new WeakMap<Key, { lib: Library; plan: EditPlan }>();
function memoApply(e: PlanEntry, lib: Library) {
  // Cache by (base, overrides) identity via a synthetic key object stored on the entry.
  const k = keyFor(e.base, e.overrides);
  let v = applied.get(k);
  if (!v || v.lib !== lib) {
    v = { lib, plan: applyOverrides(e.base, e.overrides, lib) };
    applied.set(k, v);
  }
  return v.plan;
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
  recordExport(id: string, review: ExportReview) {
    set((s) => ({ ...s, reviews: { ...s.reviews, [id]: review } }));
  },
  trackExportJob(id: string, job: ExportJob) {
    set((s) => ({ ...s, exportJobs: { ...s.exportJobs, [id]: job } }));
  },
  clearExportJob(id: string, jobId: string) {
    set((s) => {
      if (s.exportJobs[id]?.jobId !== jobId) return s;
      const exportJobs = { ...s.exportJobs }; delete exportJobs[id];
      return { ...s, exportJobs };
    });
  },
  setStyle(style: StyleChoice | null) {
    set((s) => ({ ...s, project: { ...s.project, style } }));
  },
  setPromptStyle(promptStyle: string) {
    set((s) => ({ ...s, project: { ...s.project, promptStyle } }));
  },
  setAspect(aspect: State["project"]["aspect"]) {
    set((s) => ({ ...s, project: { ...s.project, aspect } }));
  },
  setReferenceUrl(referenceUrl: string) {
    referenceFile = null;
    set((s) => ({ ...s, project: { ...s.project, referenceUrl, referenceNotice: null } }));
  },

  async upload(file: File) {
    if (!file.type.startsWith("video/")) {
      set((s) => ({ ...s, project: { ...s.project, analyzeError: "Choose a video file for your raw clip." } }));
      return false;
    }
    const ctrl = newController("analysis");
    cancelSupportingUploads(state.project.videoId);
    const current = () => controllers.get("analysis") === ctrl && !ctrl.signal.aborted;
    set((s) => ({ ...s, project: { ...s.project, fileName: file.name, videoId: null, analysis: null, analyzing: true, analyzeError: null } }));
    analysisJob = (async () => {
      const { videoId } = await api.uploadVideo(file, ctrl.signal);
      ctrl.signal.throwIfAborted();
      if (!current()) throw new DOMException("Upload replaced", "AbortError");
      set((s) => ({ ...s, project: { ...s.project, videoId } }));
      const analysis = await api.analyze(videoId, ctrl.signal);
      ctrl.signal.throwIfAborted();
      if (!current()) throw new DOMException("Upload replaced", "AbortError");
      set((s) => ({ ...s, project: { ...s.project, analysis, analyzing: false } }));
      return analysis;
    })();
    try {
      await analysisJob;
      return true;
    } catch (e) {
      if (current()) set((s) => ({ ...s, project: { ...s.project, analyzing: false, analyzeError: errMsg(e) } }));
      return false;
    } finally {
      if (controllers.get("analysis") === ctrl) controllers.delete("analysis");
    }
  },
  clearUpload() {
    cancelSupportingUploads(state.project.videoId);
    controllers.get("analysis")?.abort();
    controllers.delete("analysis");
    analysisJob = null;
    set((s) => ({ ...s, project: { ...s.project, fileName: null, videoId: null, analysis: null, analyzing: false, analyzeError: null } }));
  },
  /** Inspiration file (fallback when a link can't be fetched). Not persisted. */
  setReferenceFile(file: File | null) {
    referenceFile = file;
    set((s) => ({ ...s, project: { ...s.project, referenceUrl: file ? `upload:${file.name}` : "", referenceNotice: null } }));
  },

  async loadLibrary() {
    try {
      const library = await api.getLibrary();
      set((s) => ({ ...s, library }));
    } catch {}
  },

  async loadSupporting(primaryVideoId: string) {
    const key = `supporting-load:${primaryVideoId}`;
    if (controllers.has(key)) return;
    const ctrl = newController(key);
    try {
      const resources = await api.listSupporting(primaryVideoId, ctrl.signal);
      const assets = await Promise.all(resources.map(async (resource): Promise<SupportingUpload> => {
        const known = state.supporting[primaryVideoId]?.find((x) => (x.videoId ?? x.asset?.videoId) === resource.videoId);
        if (known?.asset) return { ...known, description: resource.description, asset: { ...known.asset, description: resource.description } };
        try {
          const a = await api.analyze(resource.videoId, ctrl.signal);
          return { id: known?.id ?? resource.assetId, videoId: resource.videoId, name: resource.filename, description: resource.description, status: "ready" as const, progress: 1, selected: known?.selected ?? true,
            asset: { videoId: a.videoId, name: resource.filename, description: resource.description, src: a.src, width: a.width, height: a.height, durationSec: a.durationSec, frames: a.frames } };
        } catch (e) {
          ctrl.signal.throwIfAborted();
          return { id: known?.id ?? resource.assetId, videoId: resource.videoId, name: resource.filename, description: resource.description, status: "error" as const, progress: 1, selected: false, error: errMsg(e) };
        }
      }));
      ctrl.signal.throwIfAborted();
      set((s) => {
        const existing = s.supporting[primaryVideoId] ?? [];
        const merged = [...existing, ...assets.filter((a) => !existing.some((x) => x.id === a.id || ((a.videoId ?? a.asset?.videoId) && (x.videoId ?? x.asset?.videoId) === (a.videoId ?? a.asset?.videoId))))];
        return { ...s, supporting: { ...s.supporting, [primaryVideoId]: merged }, supportingErrors: { ...s.supportingErrors, [primaryVideoId]: "" } };
      });
    } catch (e) {
      if (!ctrl.signal.aborted) set((s) => ({ ...s, supportingErrors: { ...s.supportingErrors, [primaryVideoId]: (e as { status?: number })?.status === 404 ? "This primary clip isn't available in this account. Upload it again to attach supporting footage." : errMsg(e) } }));
    } finally { if (controllers.get(key) === ctrl) controllers.delete(key); }
  },

  async uploadSupporting(primaryVideoId: string, file: File, planId?: string) {
    if (!file.type.startsWith("video/")) {
      set((s) => ({ ...s, supportingErrors: { ...s.supportingErrors, [primaryVideoId]: "Choose a supporting video. Still images are not supported yet." } }));
      return false;
    }
    if ((state.supporting[primaryVideoId] ?? []).filter((a) => a.asset || a.videoId || ["uploading", "analyzing"].includes(a.status)).length >= 4) {
      set((s) => ({ ...s, supportingErrors: { ...s.supportingErrors, [primaryVideoId]: "This project already has four supporting uploads. Remove an unused upload before replacing it." } }));
      return false;
    }
    const id = uid();
    const key = `supporting:${primaryVideoId}:${id}`;
    const ctrl = newController(key);
    const current = () => controllers.get(key) === ctrl && !ctrl.signal.aborted;
    const update = (patch: Partial<SupportingUpload>) => {
      if (current()) set((s) => ({ ...s, supporting: { ...s.supporting, [primaryVideoId]: (s.supporting[primaryVideoId] ?? []).map((a) => a.id === id ? { ...a, ...patch } : a) } }));
    };
    set((s) => ({ ...s, supportingErrors: { ...s.supportingErrors, [primaryVideoId]: "" }, supporting: { ...s.supporting, [primaryVideoId]: [...(s.supporting[primaryVideoId] ?? []), { id, name: file.name, description: "", status: "uploading", progress: 0, selected: true }] } }));
    try {
      const { videoId } = await api.uploadSupporting(primaryVideoId, file, "", ctrl.signal, (progress) => update({ progress }));
      ctrl.signal.throwIfAborted();
      if (!current()) return false;
      update({ status: "analyzing", progress: 1, videoId });
      const a = await api.analyze(videoId, ctrl.signal);
      ctrl.signal.throwIfAborted();
      if (!current()) return false;
      const asset = { videoId, name: file.name.slice(0, 160), description: "", src: a.src, width: a.width, height: a.height, durationSec: a.durationSec, frames: a.frames };
      update({ status: "ready", asset });
      const entry = planId ? state.plans[planId] : undefined;
      if (entry && entry.base.source.videoId === primaryVideoId) actions.override(planId!, { supporting: mergeSupporting(entry.overrides.supporting ?? entry.base.supporting, [asset]) });
      return true;
    } catch (e) {
      update({ status: "error", error: errMsg(e) });
      return false;
    } finally { if (controllers.get(key) === ctrl) controllers.delete(key); }
  },
  cancelSupporting(primaryVideoId: string, id: string) {
    const key = `supporting:${primaryVideoId}:${id}`;
    controllers.get(key)?.abort();
    controllers.delete(key);
    set((s) => ({ ...s, supporting: { ...s.supporting, [primaryVideoId]: (s.supporting[primaryVideoId] ?? []).map((a) => a.id === id ? { ...a, selected: false, status: a.status === "ready" ? "ready" : "cancelled" } : a) } }));
  },
  selectSupporting(primaryVideoId: string, id: string, selected: boolean) {
    set((s) => ({ ...s, supporting: { ...s.supporting, [primaryVideoId]: (s.supporting[primaryVideoId] ?? []).map((a) => a.id === id ? { ...a, selected } : a) } }));
  },
  async retrySupporting(primaryVideoId: string, id: string, planId?: string) {
    const item = state.supporting[primaryVideoId]?.find((a) => a.id === id);
    const videoId = item?.videoId ?? item?.asset?.videoId;
    if (!item || !videoId) return;
    const key = `supporting:${primaryVideoId}:${id}`;
    const ctrl = newController(key);
    set((s) => ({ ...s, supporting: { ...s.supporting, [primaryVideoId]: (s.supporting[primaryVideoId] ?? []).map((a) => a.id === id ? { ...a, status: "analyzing", error: undefined } : a) } }));
    try {
      const a = await api.analyze(videoId, ctrl.signal);
      ctrl.signal.throwIfAborted();
      if (controllers.get(key) !== ctrl) return;
      const asset = { videoId, name: item.name, description: item.description, src: a.src, width: a.width, height: a.height, durationSec: a.durationSec, frames: a.frames };
      set((s) => ({ ...s, supporting: { ...s.supporting, [primaryVideoId]: (s.supporting[primaryVideoId] ?? []).map((x) => x.id === id ? { ...x, asset, status: "ready", selected: true } : x) } }));
      const entry = planId ? state.plans[planId] : undefined;
      if (entry?.base.source.videoId === primaryVideoId) actions.override(planId!, { supporting: mergeSupporting(entry.overrides.supporting ?? entry.base.supporting, [asset]) });
    } catch (e) {
      if (!ctrl.signal.aborted) set((s) => ({ ...s, supporting: { ...s.supporting, [primaryVideoId]: (s.supporting[primaryVideoId] ?? []).map((x) => x.id === id ? { ...x, status: "error", error: errMsg(e) } : x) } }));
    } finally { if (controllers.get(key) === ctrl) controllers.delete(key); }
  },
  async deleteSupporting(primaryVideoId: string, id: string) {
    const item = state.supporting[primaryVideoId]?.find((a) => a.id === id);
    const videoId = item?.videoId ?? item?.asset?.videoId;
    if (videoId && Object.values(state.plans).some((e) => applyOverrides(e.base, e.overrides, state.library).broll?.some((b) => b.assetId === videoId))) throw new Error("Remove this video's cutaways from your local edits before removing the upload.");
    if (videoId) await api.deleteSupporting(primaryVideoId, videoId);
    actions.cancelSupporting(primaryVideoId, id);
    set((s) => ({ ...s, supporting: { ...s.supporting, [primaryVideoId]: (s.supporting[primaryVideoId] ?? []).filter((a) => a.id !== id) } }));
  },
  async describeSupporting(primaryVideoId: string, id: string, description: string, planId?: string) {
    const item = state.supporting[primaryVideoId]?.find((a) => a.id === id);
    if (!item?.asset) return;
    await api.describeSupporting(primaryVideoId, item.asset.videoId, description);
    set((s) => ({ ...s, supporting: { ...s.supporting, [primaryVideoId]: (s.supporting[primaryVideoId] ?? []).map((a) => a.id === id ? { ...a, description, asset: a.asset && { ...a.asset, description } } : a) } }));
    const entry = planId ? state.plans[planId] : undefined;
    if (entry?.base.source.videoId === primaryVideoId) actions.override(planId!, { supporting: (entry.overrides.supporting ?? entry.base.supporting ?? []).map((a) => a.videoId === item.asset!.videoId ? { ...a, description } : a) });
  },

  /** Retry analysis of the uploaded clip after a failure. */
  async retryAnalyze() {
    const videoId = state.project.videoId;
    if (!videoId) return;
    const ctrl = newController("analysis");
    const current = () => controllers.get("analysis") === ctrl && !ctrl.signal.aborted;
    set((s) => ({ ...s, project: { ...s.project, analyzing: true, analyzeError: null } }));
    analysisJob = api.analyze(videoId, ctrl.signal);
    try {
      const analysis = await analysisJob;
      if (current()) set((s) => ({ ...s, project: { ...s.project, analysis, analyzing: false } }));
    } catch (e) {
      if (current()) set((s) => ({ ...s, project: { ...s.project, analyzing: false, analyzeError: errMsg(e) } }));
    } finally {
      if (controllers.get("analysis") === ctrl) controllers.delete("analysis");
    }
  },

  /**
   * The core flow: ONE edit of the clip. Lives outside components so navigation doesn't cancel it.
   * Returns the plan id (or null) so the caller can open the editor.
   */
  async generate(): Promise<string | null> {
    if (isActive(state.run)) return null;
    const p = state.project;
    const ctrl = newController("main");
    const current = () => controllers.get("main") === ctrl && !ctrl.signal.aborted;
    const updateRun = (fn: (r: Run) => Run) => { if (current()) set((s) => ({ ...s, run: fn(s.run) })); };
    const setRun = (patch: Partial<Run>) => updateRun((r) => ({ ...r, ...patch }));
    const log = (text: string) => updateRun((r) => ({ ...r, log: [...(r.log ?? []), { at: Date.now() - r.startedAt, text }] }));
    set((s) => ({ ...s, run: { status: "preparing", phase: "Reading your clip", startedAt: Date.now(), slots: [null], slotErrors: [null] } }));
    try {
      // 1. Analysis (uploads analyse in the background; "sample" is the built-in demo).
      let videoId = p.videoId ?? "sample";
      if (p.fileName && analysisJob) videoId = (await withSignal(analysisJob, ctrl.signal)).videoId;
      else if (p.fileName && !p.videoId) throw new Error("Upload your clip again to continue.");
      if (!state.project.analysis || state.project.analysis.videoId !== videoId) {
        const analysis = await api.analyze(videoId, ctrl.signal);
        if (!current()) return null;
        set((s) => ({ ...s, project: { ...s.project, analysis, videoId: s.project.videoId ?? (p.fileName ? videoId : null) } }));
      }
      const a = state.project.analysis;
      if (a) log(`Read your clip · ${a.durationSec.toFixed(1)}s, ${a.words.length} words, ${a.scenes.length} scenes`);
      if (ctrl.signal.aborted) return null;

      // 2. Inspiration video → style profile (optional; failure is non-fatal).
      let styleId: string | undefined;
      const link = p.style?.kind === "link" ? p.style.url : p.referenceUrl && !p.referenceUrl.startsWith("upload:") ? p.referenceUrl : "";
      const file = p.style?.kind === "file" || p.referenceUrl.startsWith("upload:") ? referenceFile : null;
      if (link || file) {
        setRun({ phase: "Watching your inspiration video" });
        try {
          const ref = await api.reference(file ? { file } : { url: link }, videoId, ctrl.signal);
          if (!current()) return null;
          styleId = ref.styleId;
          log(`Copied the style of ${ref.title ? `“${ref.title}”` : "your reference"}${ref.cutStats ? ` · ${Math.round(ref.cutStats.cutsPerMinute)} cuts/min` : ""}`);
        } catch (e) {
          setRun({ warning: `Couldn't copy that style (${errMsg(e)}). Going without it.` });
        }
      }
      if (ctrl.signal.aborted) return null;

      log("Sent your clip to Kimi K3.1 Pro on Cerebras");
      const selected = (state.supporting[videoId] ?? []).filter((a) => a.selected !== false);
      if (selected.some((a) => a.status !== "ready")) throw new Error("Wait for supporting footage to finish, or unselect the unfinished files.");
      if (selected.length > 4) throw new Error("Choose at most four supporting videos for this edit.");
      const ids = await streamRun({ videoId, prompt: promptFor(p), styleId, aspect: p.aspect, count: 1, supportingAssetIds: selected.flatMap((a) => a.asset ? [a.asset.videoId] : []) }, ctrl.signal, updateRun);
      const first = ids[0];
      if (first && state.plans[first]) {
        // The editor opens with the agent's account of what it did.
        const e = state.plans[first];
        const intro: ChatMsg = {
          id: uid(),
          role: "agent",
          text: planSummary(e.base),
          stats: e.stats,
          workedMs: (state.run.doneAt ?? Date.now()) - state.run.startedAt,
          steps: [...(state.run.log ?? []).map((l) => l.text), ...planSteps(e.base)],
        };
        set((s) => ({ ...s, plans: { ...s.plans, [first]: { ...s.plans[first], chat: [intro] } } }));
      }
      return first ?? null;
    } catch (e) {
      if (ctrl.signal.aborted) return null;
      setRun({ status: "error", error: (e as { status?: number })?.status === 404 ? "Your clip or supporting footage isn't available in this account. Return to upload it again; your local draft is preserved." : errMsg(e) });
      return null;
    } finally {
      if (controllers.get("main") === ctrl) controllers.delete("main");
    }
  },

  /** Secondary: a few alternate takes on an edit, shown as a strip in the editor. */
  async generateAlternates(planId: string, count = 3) {
    const root = state.altRoot[planId] ?? planId;
    if (isActive(state.alts[root])) return;
    const entry = state.plans[planId];
    if (!entry) return;
    const base = applyOverrides(entry.base, entry.overrides, state.library);
    const videoId = base.source.videoId;
    const key = `alt:${root}`;
    const ctrl = newController(key);
    const setAlt = (fn: (r: Run) => Run) => {
      if (controllers.get(key) === ctrl && !ctrl.signal.aborted) set((s) => ({ ...s, alts: { ...s.alts, [root]: fn(s.alts[root]) } }));
    };
    const previous = state.alts[root]?.slots.filter((id): id is string => !!id) ?? [];
    const offset = previous.length;
    set((s) => ({
      ...s,
      altRoot: { ...s.altRoot, [root]: root },
      alts: { ...s.alts, [root]: { status: "queued", startedAt: Date.now(), queuedAt: Date.now(), slots: [...previous, ...Array(count).fill(null)], slotErrors: Array(offset + count).fill(null) } },
    }));
    try {
      const prompt = [entry.request?.prompt || base.rationale, `Make takes that differ from “${base.title}”: different hook, pacing, track and caption style.`].join("\n");
      await streamRun({ videoId, prompt, styleId: entry.request?.styleId, aspect: base.aspect, count, supportingAssetIds: (base.supporting ?? []).map((a) => a.videoId) }, ctrl.signal, setAlt, { offset, root });
    } catch (e) {
      if (!ctrl.signal.aborted) setAlt((r) => ({ ...r, status: "error", error: errMsg(e) }));
    } finally {
      if (controllers.get(key) === ctrl) controllers.delete(key);
    }
  },

  /** Cancel the main run or an alternates run (closes the stream; the server stops on disconnect). */
  cancel(which: "main" | { alternatesOf: string }) {
    const root = which === "main" ? null : (state.altRoot[which.alternatesOf] ?? which.alternatesOf);
    const key = root ? `alt:${root}` : "main";
    controllers.get(key)?.abort();
    controllers.delete(key);
    const patch = (r: Run): Run => (r && isActive(r) ? { ...r, status: r.slots.some(Boolean) ? "done" : "cancelled", doneAt: Date.now(), warning: r.slots.some(Boolean) ? "Stopped before all takes were ready." : undefined } : r);
    if (root) set((s) => ({ ...s, alts: { ...s.alts, [root]: patch(s.alts[root]) } }));
    else set((s) => ({ ...s, run: patch(s.run) }));
  },

  async ensurePlan(id: string) {
    if (planLoads.has(id)) return planLoads.get(id);
    const job = loadOwnedPlan(id);
    planLoads.set(id, job);
    try { await job; } finally { planLoads.delete(id); }
  },

  rename(id: string, name: string) {
    set((s) => (s.plans[id] ? { ...s, plans: { ...s.plans, [id]: { ...s.plans[id], name } } } : s));
  },

  async savePlan(id: string) {
    const entry = state.plans[id];
    if (!entry || entry.save?.status === "saving") return;
    const submitted = applyOverrides(entry.base, entry.overrides, state.library);
    const key = `save:${id}`;
    const ctrl = newController(key);
    const update = (patch: Partial<PlanEntry>) => set((s) => {
      const current = s.plans[id];
      return current?.serverId === entry.serverId ? { ...s, plans: { ...s.plans, [id]: { ...current, ...patch } } } : s;
    });
    update({ save: { status: "saving" } });
    try {
      let revision = entry.revision;
      if (revision === undefined) {
        const remote = await api.getPlan(entry.serverId);
        if (planKey(remote.editPlan) !== planKey(entry.savedPlan ?? entry.base)) { update({ save: { status: "conflict", message: "This edit was changed elsewhere. Reload the saved edit, or keep your local draft and export it." } }); return; }
        revision = remote.revision;
      }
      if (revision === undefined) throw new Error("The server did not return a saved revision. Reload the edit before saving.");
      const saved = await api.savePlan(entry.serverId, revision, submitted, ctrl.signal);
      ctrl.signal.throwIfAborted();
      set((s) => {
        const current = s.plans[id];
        const version = { revision: saved.revision, updatedAt: saved.updatedAt, savedPlan: saved.editPlan };
        const unchanged = current && planKey(applyOverrides(current.base, current.overrides, s.library)) === planKey(submitted);
        return { ...s, savedVersions: { ...s.savedVersions, [entry.serverId]: version }, plans: current?.serverId === entry.serverId ? { ...s.plans, [id]: { ...current, ...(unchanged ? { base: saved.editPlan, overrides: {} } : {}), ...version, save: { status: "saved" } } } : s.plans };
      });
    } catch (e) {
      if (!ctrl.signal.aborted) update({ save: { status: (e as { status?: number })?.status === 409 ? "conflict" : "error", message: errMsg(e) } });
    } finally { if (controllers.get(key) === ctrl) controllers.delete(key); }
  },
  async reloadSavedPlan(id: string) {
    const entry = state.plans[id];
    if (!entry) return;
    try {
      const saved = await api.getPlan(entry.serverId);
      if (state.plans[id]?.serverId !== entry.serverId) return;
      commit(id, () => ({ base: saved.editPlan, overrides: {}, serverId: entry.serverId }));
      set((s) => ({ ...s, savedVersions: { ...s.savedVersions, [entry.serverId]: { savedPlan: saved.editPlan, revision: saved.revision, updatedAt: saved.updatedAt } }, plans: { ...s.plans, [id]: { ...s.plans[id], revision: saved.revision, updatedAt: saved.updatedAt, savedPlan: saved.editPlan, save: { status: "saved" } } } }));
    } catch (e) { set((s) => ({ ...s, plans: { ...s.plans, [id]: { ...s.plans[id], save: { status: "error", message: errMsg(e) } } } })); }
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
        plans: { ...s.plans, [id]: { ...e, ...prev, ...serverVersion(s, e, prev), past: e.past.slice(0, -1), future: [snap(e), ...e.future] } },
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
        plans: { ...s.plans, [id]: { ...e, ...next, ...serverVersion(s, e, next), future: rest, past: [...e.past, snap(e)] } },
      };
    });
  },

  async remix(id: string, message: string) {
    const e = state.plans[id];
    if (!e || e.chat.some((m) => m.role === "agent" && m.pending)) return;
    const key = `remix:${id}`;
    const ctrl = newController(key);
    const agentId = uid();
    const t0 = Date.now();
    pushChat(id, { id: uid(), role: "user", text: message }, { id: agentId, role: "agent", text: "", pending: true, draft: "", startedAt: t0 });
    let draft = "";
    try {
      let got = false;
      for await (const ev of api.remix({ planId: e.serverId, message, editPlan: applyOverrides(e.base, e.overrides, state.library) }, ctrl.signal)) {
        ctrl.signal.throwIfAborted();
        if (ev.type === "delta") {
          draft += ev.text;
          updateChat(id, agentId, { draft });
        } else if (ev.type === "plan") {
          got = true;
          const latest = state.plans[id];
          const before = snap(latest);
          const beforePlan = applyOverrides(latest.base, latest.overrides, state.library);
          // The agent re-plans from the server copy; manual overrides reset (Revert brings them back).
          commit(id, () => ({ base: ev.editPlan, overrides: {}, serverId: ev.editPlan.id }));
          set((s) => ({ ...s, plans: { ...s.plans, [id]: { ...s.plans[id], stats: ev.stats } } }));
          const items = planDiff(beforePlan, ev.editPlan);
          if (Object.keys(latest.overrides).length) items.push("Manual tweaks reset");
          updateChat(id, agentId, {
            text: ev.reply ?? ev.editPlan.rationale,
            stats: ev.stats,
            pending: false,
            draft: undefined,
            workedMs: Date.now() - t0,
            steps: ["Read your request", "Re-planned the edit", ...items.slice(0, 3).map((i) => `Applied: ${i.charAt(0).toLowerCase()}${i.slice(1)}`), "Rebuilt the timeline"],
            change: { items: items.length ? items : ["No visible changes"], state: "open", revertTo: before },
          });
        } else if (ev.type === "error") throw new Error(ev.message);
      }
      if (!got) updateChat(id, agentId, { text: "No changes came back.", pending: false, workedMs: Date.now() - t0 });
    } catch (err) {
      updateChat(id, agentId, { text: ctrl.signal.aborted ? "Remix cancelled. Your edit is unchanged." : `Couldn't remix: ${errMsg(err)}`, pending: false, draft: undefined, workedMs: Date.now() - t0 });
    } finally {
      if (controllers.get(key) === ctrl) controllers.delete(key);
    }
  },
  cancelRemix(id: string) {
    controllers.get(`remix:${id}`)?.abort();
  },

  /** Change card actions. */
  keepChange(id: string, msgId: string) {
    const m = state.plans[id]?.chat.find((x) => x.id === msgId);
    if (m?.role !== "agent" || !m.change) return;
    updateChat(id, msgId, { change: { ...m.change, state: "kept", revertTo: undefined } });
  },
  revertChange(id: string, msgId: string) {
    const m = state.plans[id]?.chat.find((x) => x.id === msgId);
    if (m?.role !== "agent" || !m.change?.revertTo) return;
    const to = m.change.revertTo;
    commit(id, () => to);
    updateChat(id, msgId, { change: { ...m.change, state: "reverted", revertTo: undefined } });
  },
};

let analysisJob: Promise<MediaAnalysis> | null = null;
const planLoads = new Map<string, Promise<void>>();
async function loadOwnedPlan(id: string) {
  set((s) => ({ ...s, planErrors: { ...s.planErrors, [id]: "" }, planAccess: { ...s.planAccess, [id]: "checking" } }));
  try {
    const local = state.plans[id];
    const remote = await api.getPlan(local?.serverId ?? id);
    set((s) => {
      const entry = s.plans[id];
      const same = entry && planKey(remote.editPlan) === planKey(entry.savedPlan ?? entry.base);
      const next = entry ? same ? { ...entry, revision: remote.revision, updatedAt: remote.updatedAt, savedPlan: remote.editPlan } : { ...entry, save: { status: "conflict" as const, message: "A newer saved edit is available. Reload it or keep working on your local draft." } } : { ...newEntry(remote.editPlan), revision: remote.revision, updatedAt: remote.updatedAt, savedPlan: remote.editPlan };
      return { ...s, savedVersions: { ...s.savedVersions, [remote.editPlan.id]: { savedPlan: remote.editPlan, revision: remote.revision, updatedAt: remote.updatedAt } }, plans: { ...s.plans, [id]: next }, planAccess: { ...s.planAccess, [id]: "ready" } };
    });
  } catch (e) {
    const message = (e as { status?: number })?.status === 404 ? "This edit isn't available for this account. Your local draft is preserved. Start from a fresh upload, or sign in to the account that owns it." : errMsg(e);
    set((s) => ({ ...s, planErrors: { ...s.planErrors, [id]: message }, planAccess: { ...s.planAccess, [id]: "error" } }));
    return;
  }
  const videoId = state.plans[id]?.base.source.videoId;
  const assets = state.plans[id]?.base.supporting ?? [];
  if (videoId && assets.length) set((s) => ({ ...s, supporting: { ...s.supporting, [videoId]: [...(s.supporting[videoId] ?? []), ...assets.filter((a) => !(s.supporting[videoId] ?? []).some((x) => x.asset?.videoId === a.videoId)).map((asset) => ({ id: asset.videoId, name: asset.name, description: asset.description, asset, status: "ready" as const, progress: 1, selected: true }))] } }));
  if (videoId && !state.analyses[videoId] && state.project.analysis?.videoId !== videoId) {
    try {
      const analysis = await api.analyze(videoId);
      set((s) => ({ ...s, analyses: { ...s.analyses, [videoId]: analysis } }));
    } catch {}
  }
}
const controllers = new Map<string, AbortController>();
function cancelSupportingUploads(primaryVideoId: string | null) {
  if (!primaryVideoId) return;
  for (const key of controllers.keys()) {
    if (key.startsWith(`supporting:${primaryVideoId}:`)) actions.cancelSupporting(primaryVideoId, key.slice(`supporting:${primaryVideoId}:`.length));
  }
}
function newController(key: string) {
  controllers.get(key)?.abort();
  const c = new AbortController();
  controllers.set(key, c);
  return c;
}
function promptFor(p: State["project"]) {
  const hint = p.style?.kind === "preset" ? `Style: ${STYLE_LABEL[p.style.preset]}.` : p.promptStyle && p.promptStyle !== "Auto" ? `Style: ${p.promptStyle}.` : "";
  return [p.prompt.trim(), hint].filter(Boolean).join("\n");
}

/** Stream /api/variants into a Run (main or alternates). Returns the landed plan ids by index. */
async function streamRun(req: GenerateRequest, signal: AbortSignal, update: (fn: (r: Run) => Run) => void, { offset = 0, root }: { offset?: number; root?: string } = {}): Promise<(string | null)[]> {
  update((r) => ({ ...r, phase: "Sending to Cerebras" }));
  try {
    for await (const ev of api.generateVariants(req, signal)) {
      signal.throwIfAborted();
      if (ev.type === "start") update((r) => ({ ...r, status: "queued", queuedAt: Date.now(), phase: undefined }));
      else if (ev.type === "variant") {
        const { index, editPlan, stats, direction } = ev;
        const request = { videoId: req.videoId, prompt: req.prompt, styleId: req.styleId, aspect: req.aspect, supportingAssetIds: req.supportingAssetIds };
        set((s) => ({ ...s, plans: { ...s.plans, [editPlan.id]: { ...newEntry(editPlan, stats, direction), request } }, altRoot: root ? { ...s.altRoot, [editPlan.id]: root } : s.altRoot }));
        update((r) => {
          const slots = [...r.slots];
          slots[offset + index] = editPlan.id;
          return { ...r, status: "generating", slots, firstAt: r.firstAt ?? Date.now() };
        });
      } else if (ev.type === "variant-error") {
        update((r) => {
          const slotErrors = [...r.slotErrors];
          slotErrors[offset + ev.index] = ev.message;
          return { ...r, slotErrors };
        });
      } else if (ev.type === "summary") update((r) => ({ ...r, summary: ev }));
      else if (ev.type === "error") throw new Error(ev.message);
    }
  } catch (e) {
    if (signal.aborted) throw e;
    // A dropped stream keeps whatever landed.
    let landed = false;
    update((r) => {
      landed = r.slots.some(Boolean);
      return landed ? { ...r, status: "done", doneAt: Date.now(), warning: errMsg(e) } : r;
    });
    if (!landed) throw e;
  }
  let ids: (string | null)[] = [];
  update((r) => {
    ids = r.slots;
    if (r.status === "done") return r;
    return r.slots.some(Boolean) ? { ...r, status: "done", doneAt: Date.now() } : { ...r, status: "error", error: r.slotErrors.find(Boolean) ?? "The agent didn't return an edit. Try again." };
  });
  return ids;
}
let referenceFile: File | null = null;
function withSignal<T>(job: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    job.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
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
      plans: { ...s.plans, [id]: { ...e, ...next, ...serverVersion(s, e, next), past: [...e.past, snap(e)].slice(-50), future: [] } },
    };
  });
}
function serverVersion(s: State, before: Snap, next: Snap): Partial<PlanEntry> {
  if (before.serverId === next.serverId) return {};
  const version = s.savedVersions[next.serverId];
  return { revision: version?.revision, updatedAt: version?.updatedAt, savedPlan: version?.savedPlan ?? next.base, save: undefined };
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
