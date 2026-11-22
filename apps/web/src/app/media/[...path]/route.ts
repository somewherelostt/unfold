import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { requireUser } from "@/lib/auth/server";
import { storage } from "@/server/store";
import { apiError } from "@/server/api-errors";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".mp3": "audio/mpeg", ".wav": "audio/wav" };

/** Owner-authenticated media, or an exact-file capability issued to an active renderer. */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: parts } = await ctx.params;
    const token = new URL(req.url).searchParams.get("render");
    let file: string;
    if (token) file = await storage.renderMediaPath(parts, token);
    else {
      const user = await requireUser();
      if (user instanceof Response) return user;
      file = await storage.mediaPath(user, parts);
    }
    const info = await stat(file);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
    const range = req.headers.get("range");
    let start = 0;
    let end = info.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
      else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= info.size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
    const headers = { ...base, "Content-Length": String(end - start + 1), ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}) };
    if (req.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch (error) { return apiError(error); }
}

export const HEAD = GET;
