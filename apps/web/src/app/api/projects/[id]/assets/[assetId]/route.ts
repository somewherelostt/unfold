import { requireUser } from "@/lib/auth/server";
import { storage } from "@/server/store";
import { apiError } from "@/server/api-errors";
import { StorageError } from "@/server/private-storage";

type Context = { params: Promise<{ id: string; assetId: string }> };
export async function PATCH(req: Request, ctx: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const { id, assetId } = await ctx.params;
    const body = await req.json().catch(() => ({})) as { description?: unknown };
    if (typeof body.description !== "string" || body.description.length > 500) throw new StorageError(400, "Supply a description of up to 500 characters.");
    const asset = await storage.getAsset(user, assetId);
    if (asset.projectId !== id || asset.role !== "supporting") throw new StorageError(404, "Not found.");
    return Response.json({ asset: await storage.updateAsset(user, id, assetId, { description: body.description.trim() }) });
  } catch (error) { return apiError(error); }
}
export async function DELETE(_req: Request, ctx: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { const { id, assetId } = await ctx.params; return Response.json(await storage.deleteAsset(user, id, assetId)); }
  catch (error) { return apiError(error); }
}
