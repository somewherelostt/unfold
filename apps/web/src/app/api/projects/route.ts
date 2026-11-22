import { requireUser } from "@/lib/auth/server";
import { storage } from "@/server/store";
import { apiError } from "@/server/api-errors";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const projects = await storage.listProjects(user);
    return Response.json({ projects: projects.map(({ id, title, createdAt, updatedAt, plans, assets }) => ({ id, title, createdAt, updatedAt, planIds: plans, assets: Object.values(assets) })) });
  } catch (error) { return apiError(error); }
}
