import { requireUser } from "@/lib/auth/server";
import { storage } from "@/server/store";
import { apiError } from "@/server/api-errors";
import { getJobsApi, jobApiError } from "@/server/jobs";
import { getPublishingRuntime } from "@/server/publishing/runtime";
import { PublishingError } from "../../../../../../../services/publishing/src/types.ts";

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
    await storage.getProject(user, projectId);
    const publishing = getPublishingRuntime();
    const gate = await publishing.beginProjectDeletion(user, projectId);
    if (!gate.ready) return Response.json({
      error: "A publication needs verification before this project can be removed.", code: "PUBLICATION_UNRESOLVED",
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    const result = await storage.deleteProject(user, projectId, async (ids) => {
      await (await getJobsApi()).drainProject(user, projectId, ids);
    });
    await publishing.finalizeProjectDeletion(user, projectId);
    return Response.json(result);
  } catch (error) {
    if (error instanceof PublishingError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    return jobApiError(error);
  }
}
