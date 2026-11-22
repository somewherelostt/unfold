import { requireUser } from "@/lib/auth/server";
import { getJobsApi, jobApiError } from "@/server/jobs";
export const maxDuration = 300;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await requireUser(); if (owner instanceof Response) return owner;
  try { return await (await getJobsApi()).events(owner, (await context.params).id, request); }
  catch (error) { return jobApiError(error); }
}
