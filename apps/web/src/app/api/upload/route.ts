import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth/server";
import { UPLOAD_DIR } from "@/server/store";


const MAX_BYTES = 500 * 1024 * 1024;
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

/** POST multipart {file} → { videoId }. Analysis runs separately via POST /api/analyze. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Max upload is 500 MB" }, { status: 413 });
  const ext = path.extname(file.name || "").toLowerCase() || ".mp4";
  if (!VIDEO_EXT.has(ext)) return Response.json({ error: "Upload a video file (mp4, mov, webm, mkv)" }, { status: 415 });

  const videoId = `v_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, `${videoId}${ext}`), Buffer.from(await file.arrayBuffer()));
  return Response.json({ videoId });
}
