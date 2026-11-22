import "server-only";
import { AgentPlan, EditPlan } from "@unfold/core";
import { DEV_USER, isAuthConfigured, isDevNoAuth } from "@/lib/auth/env";
import { storage, store, getAnalysis, type StoredPlan } from "./store";
import { validateSavedEdit } from "./plan-access";
import { StorageError } from "./private-storage";

/** Operator-only local fixture import. This is never exposed as an HTTP endpoint. */
export async function importLocalFixture(input: { projectId: string; agentPlan: unknown; editPlan: unknown }) {
  if (!isDevNoAuth() || isAuthConfigured()) throw new StorageError(403, "Fixture import requires unconfigured local demo mode.");
  const owner = { ...DEV_USER, dev: true };
  await storage.getProject(owner, input.projectId);
  const editPlan = EditPlan.parse(input.editPlan);
  const agentPlan = AgentPlan.parse(input.agentPlan);
  const primary = await storage.getAsset(owner, editPlan.source.videoId);
  if (primary.projectId !== input.projectId || primary.role !== "primary") throw new StorageError(404, "Not found.");
  const analysis = await getAnalysis(owner, primary.videoId);
  if (!analysis || editPlan.source.src !== analysis.src) throw new StorageError(400, "The fixture must use the freshly uploaded primary video.");
  try {
    await store.getPlan(owner, editPlan.id);
    throw new StorageError(409, "Choose a new fixture plan ID.");
  } catch (error) {
    if (!(error instanceof StorageError) || error.status !== 404) throw error;
  }
  const title = `Local technical fixture · ${editPlan.title.slice(0, 100)}`;
  const rationale = "Local technical fixture for renderer integration. No model selection was performed.";
  const candidate = { ...editPlan, title, rationale, stats: null };
  const now = Date.now();
  const scaffold: StoredPlan = { editPlan: candidate, agentPlan, projectId: input.projectId, videoId: primary.videoId, createdAt: now, updatedAt: now, revision: 1 };
  const canonical = await validateSavedEdit(owner, scaffold, candidate);
  return store.putPlan(owner, input.projectId, { editPlan: canonical, agentPlan: { ...agentPlan, title, rationale }, videoId: primary.videoId, createdAt: now });
}
