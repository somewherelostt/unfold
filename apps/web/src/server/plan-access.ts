import type { EditPlan } from "@unfold/core";
import type { Owner } from "./private-storage";
import { StorageError } from "./private-storage";
import { getAnalysis, getLibrary, resolveSupporting, type StoredPlan } from "./store";
import { prepareEffectivePlan } from "./export-plan";

export async function trustedPlanInputs(owner: Owner, saved: StoredPlan, candidate: EditPlan) {
  const analysis = await getAnalysis(owner, saved.videoId);
  if (!analysis) throw new StorageError(409, "Source analysis is unavailable.");
  const supporting = await resolveSupporting(owner, saved.projectId, (candidate.supporting ?? []).map((item) => item.videoId));
  return { analysis, supporting };
}

export async function validateSavedEdit(owner: Owner, saved: StoredPlan, candidate: EditPlan) {
  const trusted = await trustedPlanInputs(owner, saved, candidate);
  try {
    return prepareEffectivePlan(saved.editPlan, candidate, await getLibrary(), trusted);
  } catch (error) { throw new StorageError(400, error instanceof Error ? error.message : "Invalid edit."); }
}
