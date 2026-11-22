import { requireUser } from "@/lib/auth/server";
import { getJobsApi, jobApiError, jobJson } from "@/server/jobs";
export async function POST(request: Request) {
  const owner = await requireUser(); if (owner instanceof Response) return owner;
  try { return jobJson(await (await getJobsApi()).enqueue(owner, await request.json().catch(() => null)), 202); }
  catch (error) { return jobApiError(error); }
}
