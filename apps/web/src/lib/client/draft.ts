"use client";

import { readPromptDraft, removePromptDraft } from "@/components/ui/prompt-draft";
import { actions, getState, persistState } from "./store";

/** Adopt incoming values once, so plain app navigation and reload retain the edited draft. */
export function adoptPromptSearch(params: Pick<URLSearchParams, "get" | "has">): boolean {
  if (params.has("draft") || !["prompt", "style", "aspect"].some((key) => params.has(key))) return false;
  if (params.has("prompt")) actions.setPrompt(params.get("prompt") ?? "");
  if (params.has("style")) {
    const style = params.get("style") ?? "Auto";
    actions.setPromptStyle(["Auto", "Pop", "Clean", "Chaos", "Storytime"].includes(style) ? style : "Auto");
  }
  if (params.has("aspect")) {
    const aspect = params.get("aspect");
    actions.setAspect(aspect === "1:1" || aspect === "16:9" ? aspect : "9:16");
  }
  return persistState();
}

// Reuse recovery across remounts so an attached clip is uploaded once.
const jobs = new Map<string, { promise: Promise<void>; cancelled: boolean }>();

export function recoverPromptDraft(id: string): Promise<void> {
  const existing = jobs.get(id);
  if (existing) return existing.promise;
  const task = { promise: Promise.resolve(), cancelled: false };
  task.promise = (async () => {
    const before = getState().project;
    const draft = await readPromptDraft(id);
    if (task.cancelled) return;
    if (!draft) throw new Error("This clip is no longer available. Attach it again, or retry recovery.");
    const current = getState().project;
    if (current.prompt === before.prompt) actions.setPrompt(draft.prompt);
    if (current.promptStyle === before.promptStyle) actions.setPromptStyle(draft.style);
    if (current.aspect === before.aspect && ["9:16", "1:1", "16:9"].includes(draft.aspect)) actions.setAspect(draft.aspect as "9:16" | "1:1" | "16:9");
    if (draft.file && !(await actions.upload(draft.file))) throw new Error(getState().project.analyzeError ?? "Couldn't recover your clip. Attach it again, or retry recovery.");
    if (!persistState()) throw new Error("Your browser couldn't save this draft. Keep this page open; your original attachment is still available for recovery.");
    if (!task.cancelled) await removePromptDraft(id).catch(() => {});
  })();
  jobs.set(id, task);
  void task.promise.catch(() => { if (jobs.get(id) === task) jobs.delete(id); });
  return task.promise;
}

export function abandonPromptDraft(id: string) {
  const task = jobs.get(id);
  if (task) task.cancelled = true;
  jobs.delete(id);
}
