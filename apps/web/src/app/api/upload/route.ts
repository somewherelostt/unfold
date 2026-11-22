import { mkdir, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth/server";
import { storage } from "@/server/store";
import { apiError } from "@/server/api-errors";
import { StorageError, type PrivateAsset } from "@/server/private-storage";
import { isSupabaseStorage } from "@/server/supabase-storage";

const MAX_BYTES = 500 * 1024 * 1024;
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

/** Multipart {file, primaryVideoId?, role?: 'supporting', description?}. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (isSupabaseStorage(storage)) return Response.json({ error: "Use the direct video upload to continue." }, { status: 415 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new StorageError(400, "A video file is required.");
    if (file.size > MAX_BYTES) throw new StorageError(413, "Max upload is 500 MB.");
    const extension = path.extname(file.name).toLowerCase();
    if (!VIDEO_EXT.has(extension)) throw new StorageError(415, "Upload a video file (mp4, mov, webm, mkv).");
    const supporting = form.get("role") === "supporting";
    if (form.get("role") && !supporting && form.get("role") !== "primary") throw new StorageError(400, "Invalid upload role.");
    const videoId = `v_${randomUUID().replaceAll("-", "")}`;
    const projectId = supporting ? String(form.get("primaryVideoId") ?? "") : videoId;
    const description = String(form.get("description") ?? "").trim();
    if (description.length > 500) throw new StorageError(400, "Descriptions can contain up to 500 characters.");
    if (supporting) await storage.getProject(user, projectId);
    else await storage.createProject(user, projectId, file.name);
    const release = await storage.acquireLease(user, projectId, "upload");
    try {
      const asset: PrivateAsset = { assetId: videoId, videoId, projectId, primaryVideoId: projectId, role: supporting ? "supporting" : "primary", description, filename: file.name.slice(0, 160), extension, status: "uploaded", createdAt: Date.now() };
      await storage.addAsset(user, projectId, asset);
      const { upload } = await storage.assetPaths(user, videoId);
      await mkdir(path.dirname(upload), { recursive: true, mode: 0o700 });
      const disk = await statfs(path.dirname(upload));
      if (disk.bavail * disk.bsize < file.size * 3 + 128 * 1024 * 1024) throw new StorageError(507, "Not enough storage for this video and its preview.");
      req.signal.throwIfAborted();
      await writeFile(upload, Buffer.from(await file.arrayBuffer()), { flag: "wx", mode: 0o600 });
      return Response.json({ videoId, assetId: videoId, projectId, primaryVideoId: projectId, status: "uploaded", asset });
    } finally { await release(); }
  } catch (error) { return apiError(error); }
}
