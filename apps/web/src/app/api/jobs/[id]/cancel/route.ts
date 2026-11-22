import { requireUser } from "@/lib/auth/server";
import { getJobsApi, jobApiError, jobJson } from "@/server/jobs";
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await requireUser(); if (owner instanceof Response) return owner;
  try { return jobJson({ job: await (await getJobsApi()).cancel(owner, (await context.params).id) }); }
  catch (error) { return jobApiError(error); }
}
