import type { PublishingRepository } from "../../../../../services/publishing/src/repository.ts";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PrivateStorage, type Owner } from "../private-storage.ts";
import type { Claim, DeliveryGrant } from "../../../../../services/publishing/src/store.ts";
import type { PublishingConfig } from "../../../../../services/publishing/src/config.ts";
import type { DispatchMedia } from "../../../../../services/publishing/src/dispatch.ts";
import { PublishingError, type CompletedExport } from "../../../../../services/publishing/src/types.ts";
import { ownedExportPath, resolveCompletedExport } from "./exports.ts";
const execute = promisify(execFile);
const streams = new Map<string, {
    ownerId: string;
    projectId: string;
    destinationId: string;
    stop: () => Promise<void>;
}>();
const hidden = () => new PublishingError("NOT_FOUND", "Not found.", 404);
export async function stopDeliveryStreams(owner: Owner, projectId?: string, accountDestinationIds?: string[]) {
    const pending = [...streams.values()].filter((stream) => stream.ownerId === owner.id && (!projectId || stream.projectId === projectId) && (!accountDestinationIds || accountDestinationIds.includes(stream.destinationId))).map((stream) => stream.stop());
    const results = await Promise.allSettled(pending);
    if (results.some((r) => r.status === "rejected"))
        throw new PublishingError("DELIVERY_DRAINING", "Video delivery is still stopping. Try again shortly.", 409);
}
const coverDirectory = (root: string, owner: Owner, projectId: string) => path.join(root, createHash("sha256").update(owner.id).digest("hex"), projectId);
export function createPublishingMedia(storage: PrivateStorage, store: PublishingRepository, config: PublishingConfig): DispatchMedia {
    const deliveryUrl = async (claim: Claim, fileKey: string, kind: "video" | "cover") => {
        if (!config.deliveryEnabled || !config.publicOrigin)
            throw new PublishingError("DELIVERY_UNAVAILABLE", "Video delivery is not ready. Try again after setup is complete.", 503);
        const grant = (await store.issueDelivery(claim.destination.id, claim.token, { fileKey, kind }, config.deliveryTtlMs));
        return `${config.publicOrigin}/api/publishing/delivery/${grant.capability}`;
    };
    return {
        async open(owner, expected: CompletedExport) {
            const release = await storage.acquireLease(owner, expected.ref.projectId, "publishing-dispatch");
            try {
                const actual = await resolveCompletedExport(storage, owner, expected.ref, config.ffprobe);
                if (actual.mediaContentSha256 !== expected.mediaContentSha256)
                    throw new PublishingError("EXPORT_CHANGED", "This export changed after the post was composed. Create a new post from the current export.", 409);
                return { absolutePath: actual.absolutePath, release };
            }
            catch (error) {
                await release();
                throw error;
            }
        },
        async videoUrl(claim) { return deliveryUrl(claim, claim.post.export.ref.fileKey, "video"); },
        async coverUrl(claim, sourcePath, frameMs) {
            const owner = { id: claim.destination.ownerId }, projectId = claim.post.export.ref.projectId;
            const fileKey = `cover_${claim.destination.id.replace(/-/g, "")}_${createHash("sha256").update(`${claim.post.export.mediaContentSha256}:${frameMs}`).digest("hex").slice(0, 20)}.jpg`;
            const root = coverDirectory(config.coverRoot, owner, projectId);
            await mkdir(root, { recursive: true, mode: 0o700 });
            const file = path.join(root, fileKey);
            try {
                if (!(await stat(file)).isFile())
                    throw Error();
            }
            catch {
                await execute(config.ffmpeg, ["-v", "error", "-nostdin", "-ss", String(frameMs / 1000), "-i", sourcePath, "-frames:v", "1", "-vf", "scale=min(1000\\,iw):-2", "-q:v", "3", "-update", "1", "-y", file], { timeout: 20000, maxBuffer: 256000, killSignal: "SIGKILL" });
                await chmod(file, 0o600);
            }
            const info = await stat(file);
            if (!info.isFile() || info.size < 1 || info.size > 8000000)
                throw new PublishingError("COVER_UNAVAILABLE", "A cover image could not be prepared from this video.", 409);
            return deliveryUrl(claim, fileKey, "cover");
        },
    };
}
function parseRange(header: string | null, size: number) {
    if (!header)
        return { start: 0, end: size - 1, partial: false };
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match || (!match[1] && !match[2]))
        return null;
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (!match[1] && Number(match[2]) <= 0))
        return null;
    return { start, end, partial: true };
}
/** Credential-free, narrowly scoped provider delivery. Never accepts a file path or owner from the URL. */
export async function servePublishingDelivery(request: Request, capability: string, storage: PrivateStorage, store: PublishingRepository, config: PublishingConfig): Promise<Response> {
    if (!config.deliveryEnabled || !["GET", "HEAD"].includes(request.method))
        throw hidden();
    const grant: DeliveryGrant = (await store.delivery(capability)), owner = { id: grant.ownerId };
    (await store.assertAdmission(owner, grant.projectId));
    const post = (await store.get(owner, grant.postId));
    const source = await ownedExportPath(storage, owner, post.export.ref);
    const file = grant.kind === "video" ? source.absolutePath : path.join(coverDirectory(config.coverRoot, owner, grant.projectId), grant.fileKey);
    if (grant.kind === "video" && grant.fileKey !== post.export.ref.fileKey)
        throw hidden();
    const release = await storage.acquireLease(owner, grant.projectId, "publishing-delivery");
    let transferred = false;
    try {
        // Recheck after acquiring the lease so deletion/disconnection cannot race admission.
        (await store.delivery(capability));
        await storage.getProject(owner, grant.projectId);
        const info = await stat(file);
        if (!info.isFile() || info.size < 1)
            throw hidden();
        const range = parseRange(request.headers.get("range"), info.size);
        const headers = new Headers({ "Content-Type": grant.kind === "video" ? "video/mp4" : "image/jpeg", "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", "Content-Disposition": `inline; filename="${grant.kind === "video" ? "video.mp4" : "cover.jpg"}"` });
        if (!range) {
            headers.set("Content-Range", `bytes */${info.size}`);
            return new Response(null, { status: 416, headers });
        }
        headers.set("Content-Length", String(range.end - range.start + 1));
        if (range.partial)
            headers.set("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
        if (request.method === "HEAD")
            return new Response(null, { status: range.partial ? 206 : 200, headers });
        const id = randomUUID(), sourceStream = createReadStream(file, { start: range.start, end: range.end, highWaterMark: 64 * 1024 });
        let finished = false, finishing: Promise<void> | null = null, controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
        const finish = () => { if (finishing)
            return finishing; finished = true; clearInterval(check); request.signal.removeEventListener("abort", onAbort); sourceStream.destroy(); finishing = release().finally(() => { streams.delete(id); }); return finishing; };
        const stop = () => { try {
            controllerRef?.error(hidden());
        }
        catch { } return finish(); };
        const onAbort = () => { void stop().catch(() => { }); };
        const check = setInterval(async () => { try {
            (await store.delivery(capability));
            (await store.assertAdmission(owner, grant.projectId));
        }
        catch {
            void stop().catch(() => { });
        } }, 500);
        check.unref();
        const iterator = sourceStream[Symbol.asyncIterator]();
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controllerRef = controller; streams.set(id, { ownerId: owner.id, projectId: grant.projectId, destinationId: grant.destinationId, stop }); request.signal.addEventListener("abort", onAbort, { once: true }); if (request.signal.aborted)
                onAbort(); },
            async pull(controller) { try {
                (await store.delivery(capability));
                const chunk = await iterator.next();
                if (finished)
                    return;
                if (chunk.done) {
                    controller.close();
                    await finish();
                }
                else
                    controller.enqueue(chunk.value);
            }
            catch {
                try {
                    controller.error(hidden());
                }
                finally {
                    await finish();
                }
            } },
            async cancel() { await finish(); },
        });
        transferred = true;
        return new Response(body, { status: range.partial ? 206 : 200, headers });
    }
    finally {
        if (!transferred)
            await release();
    }
}
