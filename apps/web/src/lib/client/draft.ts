"use client";

import { readPromptDraft, removePromptDraft } from "@/components/ui/prompt-draft";
import { actions, getState } from "./store";

// Reuse recovery across remounts so an attached clip is uploaded once.
const jobs = new Map<string, { promise: Promise<void>; cancelled: boolean }>();

export function recoverPromptDraft(id: string): Promise<void> {
  const existing = jobs.get(id);
  if (existing) return existing.promise;
  const task = { promise: Promise.resolve(), cancelled: false };
  task.promise = (async () => {
    const draft = await readPromptDraft(id);
    if (task.cancelled) return;
    if (!draft) throw new Error("This clip is no longer available. Attach it again, or retry recovery.");
    actions.setPrompt(draft.prompt);
    actions.setPromptStyle(draft.style);
    if (["9:16", "1:1", "16:9"].includes(draft.aspect)) actions.setAspect(draft.aspect as "9:16" | "1:1" | "16:9");
    if (draft.file && !(await actions.upload(draft.file))) throw new Error(getState().project.analyzeError ?? "Couldn't recover your clip. Attach it again, or retry recovery.");
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
