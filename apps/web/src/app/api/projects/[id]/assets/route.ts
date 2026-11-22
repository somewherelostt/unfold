import { requireUser } from "@/lib/auth/server";
import { storage } from "@/server/store";
import { apiError } from "@/server/api-errors";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const project = await storage.getProject(user, (await ctx.params).id);
    return Response.json({ assets: Object.values(project.assets).filter((asset) => asset.role === "supporting") });
  } catch (error) { return apiError(error); }
}
