import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { PrivateStorage, type Owner } from "../private-storage.ts";
import { ID, PublishingError, type CompletedExport, type CompletedExportRef, type MediaProperties } from "../../../../../services/publishing/src/types.ts";
const execute = promisify(execFile);
export type ResolvedExport = CompletedExport & { absolutePath: string };
export function publicExport(value: ResolvedExport): CompletedExport { return { ref: value.ref, mediaContentSha256: value.mediaContentSha256, properties: value.properties, previewUrl: value.previewUrl, ...(value.settings ? { settings: value.settings } : {}), ...(value.renderedPlanFingerprint ? { renderedPlanFingerprint: value.renderedPlanFingerprint } : {}) }; }
export function parseExportRef(value: unknown): CompletedExportRef {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["projectId", "fileKey"].includes(key))) throw new PublishingError("INVALID_EXPORT", "Choose a completed video export.");
  const v = value as CompletedExportRef;
  if (typeof v.projectId !== "string" || !ID.test(v.projectId) || typeof v.fileKey !== "string" || !/^[A-Za-z0-9_-]{1,100}\.mp4$/.test(v.fileKey)) throw new PublishingError("INVALID_EXPORT", "Choose a completed video export.");
  return { projectId: v.projectId, fileKey: v.fileKey };
}
export async function ownedExportPath(storage: PrivateStorage, owner: Owner, value: CompletedExportRef) {
  const ref = parseExportRef(value); await storage.getProject(owner, ref.projectId);
  const absolutePath = await storage.mediaPath(owner, [ref.projectId, "exports", ref.fileKey]);
  const info = await stat(absolutePath);
  if (!info.isFile() || info.size < 1 || info.size > 2_000_000_000) throw new PublishingError("INVALID_EXPORT", "This completed export is unavailable or exceeds the supported size.", 409);
  return { ref, absolutePath, info };
}
/** Registry-backed: supports both completed SSE exports and durable media-job exports. */
export async function resolveCompletedExport(storage: PrivateStorage, owner: Owner, value: CompletedExportRef, ffprobe = "ffprobe"): Promise<ResolvedExport> {
  const ref = parseExportRef(value), release = await storage.acquireLease(owner, ref.projectId, "publishing-inspect");
  try {
    const { absolutePath, info } = await ownedExportPath(storage, owner, ref);
    const { stdout } = await execute(ffprobe, ["-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate", "-of", "json", absolutePath], { timeout: 15_000, maxBuffer: 256_000, killSignal: "SIGKILL" });
    const probe = JSON.parse(stdout), video = probe.streams?.find((s: { codec_type: string }) => s.codec_type === "video"), audio = probe.streams?.find((s: { codec_type: string }) => s.codec_type === "audio");
    const [n, d] = String(video?.avg_frame_rate).split("/").map(Number);
    const properties: MediaProperties = { bytes: info.size, duration: Number(probe.format?.duration), width: Number(video?.width), height: Number(video?.height), fps: n / d, videoCodec: String(video?.codec_name ?? ""), audioCodec: audio ? String(audio.codec_name) : null, mime: "video/mp4" };
    if (!String(probe.format?.format_name).split(",").includes("mp4") || ![properties.duration, properties.width, properties.height, properties.fps].every((n) => Number.isFinite(n) && n > 0)) throw new PublishingError("INVALID_EXPORT", "This export could not be inspected. Choose a complete MP4 video.", 409);
    const hash = createHash("sha256"); for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
    const after = await stat(absolutePath);
    if (after.ino !== info.ino || after.mtimeMs !== info.mtimeMs || after.size !== info.size) throw new PublishingError("EXPORT_CHANGED", "This export changed during inspection. Select it again.", 409);
    await ownedExportPath(storage, owner, ref);
    return { ref, absolutePath, mediaContentSha256: hash.digest("hex"), properties, previewUrl: `/media/${ref.projectId}/exports/${ref.fileKey}` };
  } catch (error) {
    if (error instanceof PublishingError || (error && typeof error === "object" && "status" in error)) throw error;
    throw new PublishingError("INSPECTION_FAILED", "This video could not be inspected. Try selecting the completed export again.", 409);
  } finally { await release(); }
}
export async function listCompletedExports(storage: PrivateStorage, owner: Owner) {
  const projects = await storage.listProjects(owner), result: { ref: CompletedExportRef; title: string; previewUrl: string; createdAt: number; bytes: number }[] = [];
  for (const p of projects.slice(0, 100)) for (const fileKey of p.exports.filter((key) => /^[A-Za-z0-9_-]{1,100}\.mp4$/.test(key)).slice(-20)) {
    try { const { info } = await ownedExportPath(storage, owner, { projectId: p.id, fileKey }); result.push({ ref: { projectId: p.id, fileKey }, title: p.title, previewUrl: `/media/${p.id}/exports/${fileKey}`, createdAt: info.mtimeMs, bytes: info.size }); } catch { /* Deleted/incomplete resources are never offered. */ }
  }
  return result.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}
