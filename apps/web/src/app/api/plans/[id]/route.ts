import { requireUser } from "@/lib/auth/server";
import { store } from "@/server/store";


/** GET → {editPlan, agentPlan, videoId} */
export async function GET(_req: Request, ctx: RouteContext<"/api/plans/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const plan = await store.getPlan(id).catch(() => null);
  if (!plan) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(plan);
}
