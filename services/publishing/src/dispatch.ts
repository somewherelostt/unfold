import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { ComposioClient, numericId, object, ProviderFault, type JsonObject } from "./composio.ts";
import { PublishingStore, type Claim } from "./store.ts";
import { PublishingError, type Checkpoint, type CompletedExport, type Owner } from "./types.ts";
import { validateDestination } from "./validation.ts";
import type { PublishingConfig } from "./config.ts";

export type DispatchMedia = {
  /** Must re-authorize the registered export, compare its content hash, and acquire an active storage lease. */
  open(owner: Owner, media: CompletedExport): Promise<{ absolutePath: string; release: () => Promise<void> }>;
  videoUrl(claim: Claim): Promise<string>;
  coverUrl(claim: Claim, sourcePath: string, frameMs: number): Promise<string>;
};
function receiptId(value: unknown) { const id = numericId(value); if (!id) throw new ProviderFault("INVALID_RECEIPT", "The platform did not return a publication receipt. Its result needs verification.", "ambiguous"); return id; }
function instagramPermalink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const u = new URL(value); return u.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(u.hostname) && /^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname) && !u.username && !u.password ? `${u.origin}${u.pathname}` : null; } catch { return null; }
}
/** Stream bytes directly to the exact Pinterest-owned S3 upload host; no social credentials leave the adapter. */
export async function uploadPinterestVideo(result: JsonObject, file: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (typeof result.upload_url !== "string") throw new ProviderFault("UPLOAD_UNAVAILABLE", "Pinterest did not return a video upload destination.", "ambiguous");
  const url = new URL(result.upload_url);
  if (url.protocol !== "https:" || !/^[a-z0-9][a-z0-9.-]*\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname) || url.username || url.password || url.port) throw new PublishingError("UPLOAD_UNAVAILABLE", "Pinterest returned an unsupported video upload destination.", 502);
  const params = object(result.upload_parameters), boundary = `unfold${randomBytes(24).toString("hex")}`;
  const fields = Object.entries(params);
  if (!fields.length || fields.length > 30 || fields.some(([key, value]) => !/^[A-Za-z0-9_-]{1,100}$/.test(key) || typeof value !== "string" || value.length > 30_000)) throw new ProviderFault("UPLOAD_UNAVAILABLE", "Pinterest’s video upload instructions are incomplete.", "ambiguous");
  const prefix = Buffer.from(fields.map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join("") + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="video.mp4"\r\nContent-Type: video/mp4\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`), bytes = (await stat(file)).size;
  const body = Readable.from((async function* () { yield prefix; for await (const chunk of createReadStream(file)) yield chunk; yield suffix; })());
  let response: Response;
  try { response = await fetcher(url, { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(prefix.length + bytes + suffix.length) }, body: Readable.toWeb(body), duplex: "half", redirect: "error", signal: AbortSignal.timeout(90_000) } as RequestInit); }
  catch { body.destroy(); throw new ProviderFault("UPLOAD_INTERRUPTED", "The upload result needs verification before continuing.", "ambiguous"); }
  if (response.status !== 204 && response.status !== 201) throw new ProviderFault("UPLOAD_UNCONFIRMED", "Pinterest did not confirm the video upload. Its result needs verification.", [400, 403, 413].includes(response.status) ? "rejected" : "ambiguous");
}

export class Publisher {
  constructor(private store: PublishingStore, private client: ComposioClient, private media: DispatchMedia, private upload = uploadPinterestVideo, private transport: Pick<PublishingConfig, "instagramDelivery" | "pinterestCover"> = { instagramDelivery: "staged_file", pinterestCover: "key_frame" }) {}
  private async mutate(claim: Claim, kind: string, work: (operationId: string) => Promise<Checkpoint>) {
    const id = this.store.reserveOperation(claim.destination.id, claim.token, kind);
    try { const checkpoint = await work(id); this.store.completeOperation(claim.destination.id, claim.token, id, checkpoint); return checkpoint; }
    catch (error) { if (error instanceof ProviderFault && error.outcome === "rejected") this.store.rejectOperation(claim.destination.id, claim.token, id); throw error; }
  }
  async dispatch(claim: Claim): Promise<void> {
    const d = claim.destination, cp = d.checkpoint, owner = { id: d.ownerId };
    const release = (state: Parameters<PublishingStore["release"]>[2]["state"], checkpoint?: Checkpoint, error?: Parameters<PublishingStore["release"]>[2]["error"], delayMs?: number) => this.store.release(d.id, claim.token, { state, checkpoint, error, delayMs });
    let resource: Awaited<ReturnType<DispatchMedia["open"]>> | undefined;
    try {
      if (process.env.NODE_ENV === "production" && claim.post.ownerMode !== "verified") { release(d.activeOperation || cp.postId ? "unknown" : "failed", undefined, { code: "SIGN_IN_REQUIRED", message: "This post was created in a development workspace and cannot publish in production. Sign in and create a new post.", retryable: false }); return; }
      if (d.input.platform === "bluesky") throw new PublishingError("VIDEO_UNAVAILABLE", "Bluesky video publishing is not available through this connection.", 409);
      const account = await this.client.verifyAccount(this.store.account(owner, d.input.accountId)); this.store.putAccount(account);
      if (account.status !== "connected") throw new ProviderFault("RECONNECT_REQUIRED", "Reconnect this account before publishing.", "rejected", true);
      if (!d.activeOperation && !cp.postId) {
        this.store.assertAdmission(owner, claim.post.export.ref.projectId);
        const invalid = validateDestination(d.input, claim.post.export).filter((i) => i.severity === "error"); if (invalid.length) throw new PublishingError("INVALID_POST", invalid[0].message);
        resource = await this.media.open(owner, claim.post.export);
      }
      if (d.input.platform === "instagram") {
        if (cp.postId) {
          const result = await this.client.execute(account, "INSTAGRAM_GET_IG_MEDIA", { ig_media_id: cp.postId, fields: "id,permalink,media_type,media_product_type" }, false);
          const link = instagramPermalink(result.permalink);
          if (result.id !== cp.postId || !link) throw new ProviderFault("RECEIPT_PENDING", "Instagram has not returned a final post link yet.", "read_failed", true);
          if (d.activeOperation) this.store.resolveAmbiguous(d.id, claim.token, { postId: cp.postId, permalink: link });
          release("published", { permalink: link }); return;
        }
        if (d.activeOperation && !cp.containerId) { release("unknown", undefined, d.error ?? { code: "CONTAINER_UNCONFIRMED", message: "The connection ended before Instagram returned a container. Review the account before creating another post.", retryable: false }); return; }
        if (!cp.containerId) {
          const checkpoint = await this.mutate(claim, "instagram_container", async (operationId) => {
            let source: JsonObject, staged: Checkpoint = {};
            if (this.transport.instagramDelivery === "staged_file") {
              const file = await this.client.stageInstagramVideo(resource!.absolutePath, `${d.id}.mp4`, (id) => { staged = { stagedFileId: id, stagedAt: Date.now() }; this.store.checkpointOperation(d.id, claim.token, operationId, staged); }); source = { video_file: file.file };
            } else source = { video_url: await this.media.videoUrl(claim) };
            const result = await this.client.execute(account, "INSTAGRAM_POST_IG_USER_MEDIA", { ig_user_id: account.identity!.id, media_type: "REELS", ...source, caption: d.input.text, share_to_feed: d.input.instagram!.shareToFeed, thumb_offset: d.input.instagram!.thumbnailMs }, true);
            return { ...staged, containerId: receiptId(result.id), processingStartedAt: Date.now() };
          });
          release("processing", checkpoint); return;
        }
        const nodes = await this.client.execute(account, "INSTAGRAM_GET_MULTIPLE_NODES", { object_ids: [cp.containerId], fields: "id,status_code,status" }, false);
        const container = object(nodes[cp.containerId]);
        if (container.id !== cp.containerId || typeof container.status_code !== "string") throw new ProviderFault("STATUS_UNAVAILABLE", "Instagram’s processing status is temporarily unavailable.", "read_failed", true);
        if (d.activeOperation) {
          // FINISHED after a timeout is not proof that a prior publish was rejected. Never re-publish it.
          release("unknown", undefined, { code: container.status_code === "PUBLISHED" ? "PUBLISHED_RECEIPT_MISSING" : "PUBLISH_UNCONFIRMED", message: container.status_code === "PUBLISHED" ? "Instagram reports this container as published, but has not returned its final post receipt. Check the account; this destination will not be published again." : "The prior request’s outcome is still unconfirmed. Check Instagram before creating another post.", retryable: false }); return;
        }
        if (["ERROR", "EXPIRED"].includes(container.status_code)) { release("failed", undefined, { code: "VIDEO_PROCESSING_FAILED", message: "Instagram could not process this video. Inspect the export and create a new post.", retryable: false }); return; }
        if (container.status_code === "PUBLISHED") { release("unknown", undefined, { code: "PUBLISHED_RECEIPT_MISSING", message: "Instagram reports this container as published. Its final link still needs verification.", retryable: false }); return; }
        if (container.status_code !== "FINISHED") {
          if (d.reconcileOnly) { release("unknown", undefined, { code: "PROCESSING_DELAYED", message: "Instagram is still processing the video. Check its result again later.", retryable: false }); return; }
          if (Date.now() - (cp.processingStartedAt ?? d.createdAt) > 5 * 60_000) { release("unknown", undefined, { code: "PROCESSING_DELAYED", message: "Instagram is taking longer than expected. Check status again before posting another copy.", retryable: false }); return; }
          release("processing"); return;
        }
        if (d.reconcileOnly) { release("failed", undefined, { code: "READY_TO_RETRY", message: "The video is ready. Retry this destination when you want to publish it.", retryable: true }); return; }
        const checkpoint = await this.mutate(claim, "instagram_publish", async () => { const r = await this.client.execute(account, "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", { ig_user_id: account.identity!.id, creation_id: cp.containerId, max_wait_seconds: 0 }, true); return { postId: receiptId(r.id) }; });
        release("processing", checkpoint, null, 0); return;
      }
      if (cp.postId) {
        const pin = await this.client.execute(account, "PINTEREST_GET_PIN", { pin_id: cp.postId }, false);
        if (pin.id !== cp.postId) throw new ProviderFault("RECEIPT_PENDING", "Pinterest has not returned the final Pin receipt yet.", "read_failed", true);
        const link = `https://www.pinterest.com/pin/${cp.postId}/`;
        if (d.activeOperation) this.store.resolveAmbiguous(d.id, claim.token, { postId: cp.postId, permalink: link });
        release("published", { permalink: link }); return;
      }
      const board = await this.client.execute(account, "PINTEREST_GET_BOARD", { board_id: d.input.pinterest!.boardId }, false);
      if (board.id !== d.input.pinterest!.boardId) throw new PublishingError("BOARD_UNAVAILABLE", "This Pinterest board is no longer available. Choose a current destination in a new post.", 409);
      if (d.activeOperation && !cp.uploadId) { release("unknown", undefined, { code: "UPLOAD_UNCONFIRMED", message: "The video upload needs verification. Check Pinterest before creating another post.", retryable: false }); return; }
      if (!cp.uploadId) {
        const checkpoint = await this.mutate(claim, "pinterest_prepare_initial", async (operationId) => {
          const result = await this.client.execute(account, "PINTEREST_REGISTER_MEDIA", { media_type: "video" }, true);
          const mediaId = receiptId(result.media_id);
          // Persist the media ID before sending bytes; upload policy stays only in process memory.
          const checkpoint = { uploadId: mediaId, processingStartedAt: Date.now() };
          this.store.checkpointOperation(d.id, claim.token, operationId, checkpoint);
          await this.upload(result, resource!.absolutePath);
          return checkpoint;
        });
        release("processing", checkpoint); return;
      }
      const uploaded = await this.client.execute(account, "PINTEREST_GET_MEDIA", { media_id: cp.uploadId }, false);
      if (d.activeOperation) {
        if (d.activeOperation.kind.startsWith("pinterest_prepare_") && String(uploaded.status).toLowerCase() === "succeeded") { this.store.resolvePreparation(d.id, claim.token, cp.uploadId); if (d.reconcileOnly) release("failed", undefined, { code: "READY_TO_RETRY", message: "The video is ready. Retry this destination when you want to publish it.", retryable: true }); else release("processing", undefined, null, 0); return; }
        if (d.activeOperation.kind.startsWith("pinterest_prepare_") && !["failed", "error"].includes(String(uploaded.status).toLowerCase()) && Date.now() - (cp.processingStartedAt ?? d.createdAt) < 5 * 60_000) { release("reconciling"); return; }
        release("unknown", undefined, { code: "PIN_UNCONFIRMED", message: "The prior Pinterest request needs verification. This destination will not be published again automatically.", retryable: false }); return;
      }
      if (["failed", "error"].includes(String(uploaded.status).toLowerCase())) { release("failed", undefined, { code: "VIDEO_PROCESSING_FAILED", message: "Pinterest could not process this video. Inspect the export and create a new post.", retryable: false }); return; }
      if (String(uploaded.status).toLowerCase() !== "succeeded") {
        if (d.reconcileOnly) { release("unknown", undefined, { code: "PROCESSING_DELAYED", message: "Pinterest is still processing the video. Check its result again later.", retryable: false }); return; }
        if (Date.now() - (cp.processingStartedAt ?? d.createdAt) > 5 * 60_000) { release("unknown", undefined, { code: "PROCESSING_DELAYED", message: "Pinterest is taking longer than expected. Check its status before creating another post.", retryable: false }); return; }
        release("processing"); return;
      }
      if (d.reconcileOnly) { release("failed", undefined, { code: "READY_TO_RETRY", message: "The video is ready. Retry this destination when you want to publish it.", retryable: true }); return; }
      const cover = this.transport.pinterestCover === "key_frame" ? { cover_image_key_frame_time: d.input.pinterest!.coverFrameMs / 1000 } : { cover_image_url: await this.media.coverUrl(claim, resource!.absolutePath, d.input.pinterest!.coverFrameMs) };
      const checkpoint = await this.mutate(claim, "pinterest_publish", async () => {
        const pin = await this.client.execute(account, "PINTEREST_CREATE_PIN", { board_id: d.input.pinterest!.boardId, title: d.input.pinterest!.title, description: d.input.text, alt_text: d.input.pinterest!.altText, ...(d.input.pinterest!.link ? { link: d.input.pinterest!.link } : {}), media_source: { source_type: "video_id", media_id: cp.uploadId, ...cover } }, true);
        return { postId: receiptId(pin.id) };
      });
      release("processing", checkpoint, null, 0);
    } catch (error) {
      // A lost fence can never update a newer worker's state.
      if (error instanceof PublishingError && error.code === "LEASE_LOST") return;
      const current = this.store.get(owner, claim.post.id).destinations.find((item) => item.id === d.id)!;
      try {
        if (error instanceof ProviderFault && error.code === "RECONNECT_REQUIRED") {
          const account = this.store.account(owner, d.input.accountId); if (account.status !== "disconnected") this.store.putAccount({ ...account, status: "reconnect_required" });
          const accepted = Boolean(current.activeOperation || current.checkpoint.postId); release(accepted ? "unknown" : "failed", undefined, { code: error.code, message: error.message, retryable: !accepted });
        }
        else if (current.activeOperation) release("reconciling", undefined, { code: error instanceof ProviderFault || error instanceof PublishingError ? error.code : "RESULT_UNCONFIRMED", message: error instanceof ProviderFault || error instanceof PublishingError ? error.message : "The platform may have received this request. Checking its result before another attempt.", retryable: false });
        else if (error instanceof ProviderFault && error.outcome === "read_failed") release("processing", undefined, { code: error.code, message: error.message, retryable: false });
        else release("failed", undefined, { code: error instanceof ProviderFault || error instanceof PublishingError ? error.code : "PUBLISHING_FAILED", message: error instanceof ProviderFault || error instanceof PublishingError ? error.message : "The post could not be completed. Check the account and export before trying again.", retryable: error instanceof ProviderFault && error.retryable });
      } catch (fence) { if (!(fence instanceof PublishingError) || fence.code !== "LEASE_LOST") throw fence; }
    } finally { await resource?.release(); }
  }
}
