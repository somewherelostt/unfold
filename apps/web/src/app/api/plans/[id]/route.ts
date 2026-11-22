import { EditPlan } from "@unfold/core";
import { requireUser } from "@/lib/auth/server";
import { store, storage, type StoredPlan } from "@/server/store";
import { validateSavedEdit } from "@/server/plan-access";
import { apiError } from "@/server/api-errors";
import { StorageError } from "@/server/private-storage";

type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await store.getPlan(user, (await ctx.params).id)); }
  catch (error) { return apiError(error); }
}

export async function PATCH(req: Request, ctx: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const id = (await ctx.params).id;
    const body = await req.json().catch(() => ({})) as { revision?: unknown; editPlan?: unknown };
    const candidate = EditPlan.safeParse(body.editPlan);
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1 || !candidate.success) throw new StorageError(400, "Supply a valid revision and edit plan.");
    const saved = await store.getPlan(user, id);
    const editPlan = await validateSavedEdit(user, saved, candidate.data);
    const updated = await storage.reviseRecord<StoredPlan>(user, saved.projectId, id, Number(body.revision), async (current) => ({ ...current, editPlan }));
    return Response.json({ editPlan: updated.editPlan, revision: updated.revision, updatedAt: updated.updatedAt });
  } catch (error) { return apiError(error); }
}
