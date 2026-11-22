import { requireUser } from "@/lib/auth/server";
import { storage } from "@/server/store";
import { apiError } from "@/server/api-errors";
import { getJobsApi, jobApiError } from "@/server/jobs";

type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const { id } = await ctx.params;
    const project = await storage.getProject(user, id);
    return Response.json({ project: { id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt, planIds: project.plans }, assets: Object.values(project.assets) });
  } catch (error) { return apiError(error); }
}
export async function DELETE(_req: Request, ctx: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const projectId = (await ctx.params).id;
    return Response.json(await storage.deleteProject(user, projectId, async (ids) => {
      await (await getJobsApi()).drainProject(user, projectId, ids);
    }));
  } catch (error) { return jobApiError(error); }
}
