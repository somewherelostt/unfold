import { randomUUID } from "node:crypto";
import { accountView, ID, isPlatform, PLATFORMS, postView, PublishingError, type Account, type Owner, type ScheduleInput } from "../../../../../services/publishing/src/types.ts";
import { object, ProviderFault } from "../../../../../services/publishing/src/composio.ts";
import { parseDestinations, validateDestination } from "../../../../../services/publishing/src/validation.ts";
import { resolveSchedule } from "../../../../../services/publishing/src/time.ts";
import { listCompletedExports, parseExportRef, publicExport, resolveCompletedExport } from "./exports.ts";
import type { PublishingRuntime } from "./runtime.ts";
import { stopDeliveryStreams } from "./media.ts";

const exact = (value: Record<string, unknown>, keys: string[]) => { if (Object.keys(value).some((key) => !keys.includes(key))) throw new PublishingError("INVALID_REQUEST", "Unexpected post settings."); };
function schedule(value: unknown): ScheduleInput { const v = object(value); exact(v, v.mode === "now" ? ["mode"] : ["mode", "localDateTime", "timeZone", "disambiguation"]); if ((v.mode !== "now" && v.mode !== "scheduled") || (v.disambiguation !== undefined && !["earlier", "later"].includes(String(v.disambiguation)))) throw new PublishingError("INVALID_TIME", "Choose Publish now or a valid scheduled time."); return v as ScheduleInput; }
function revision(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new PublishingError("INVALID_REVISION", "Reload this post before changing it."); return Number(value); }
export const publishingJson = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
export function publishingError(error: unknown) {
  if (error instanceof PublishingError) return publishingJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof ProviderFault) return publishingJson({ error: error.message, code: error.code }, error.code === "RECONNECT_REQUIRED" ? 409 : 502);
  if (error && typeof error === "object" && "status" in error && Number.isInteger(error.status)) return publishingJson({ error: Number(error.status) === 404 ? "Not found." : "This resource is unavailable.", code: "RESOURCE_UNAVAILABLE" }, Number(error.status));
  return publishingJson({ error: "Publishing could not complete this request. Try again shortly.", code: "PUBLISHING_UNAVAILABLE" }, 500);
}
export function requireSameOrigin(request: Request, appOrigin: string | null) {
  const expected = appOrigin ?? new URL(request.url).origin;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") throw new PublishingError("INVALID_ORIGIN", "Reload the app before changing your posts or connections.", 403);
}
export async function publishingBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length") ?? 0) > 100_000) throw new PublishingError("INVALID_REQUEST", "Use valid post settings.", 413);
  const reader = request.body?.getReader(); if (!reader) throw new PublishingError("INVALID_REQUEST", "Use valid post settings.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 100_000) { await reader.cancel(); throw new PublishingError("INVALID_REQUEST", "Post settings are too large.", 413); } chunks.push(next.value); } } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let cursor = 0; for (const chunk of chunks) { joined.set(chunk, cursor); cursor += chunk.byteLength; } const raw = new TextDecoder().decode(joined);
  try { const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(); return value as Record<string, unknown>; } catch { throw new PublishingError("INVALID_REQUEST", "Use valid post settings."); }
}
export function createPublishingApi(runtime: PublishingRuntime) {
  const { config, store, storage, client } = runtime;
  const ownedPost = async (owner: Owner, id: string) => { const p = store.get(owner, id); await storage.getProject(owner, p.export.ref.projectId); return p; };
  const requireReady = () => { if (!config.enabled || !config.apiKey || !store.workerReady()) throw new PublishingError("PUBLISHING_PAUSED", "Publishing is temporarily paused. Your drafts remain saved.", 503); };
  const verifyInputs = async (owner: Owner, value: unknown, media: Awaited<ReturnType<typeof resolveCompletedExport>>, draft: boolean) => {
    const destinations = parseDestinations(value);
    for (const d of destinations) {
      const a = store.account(owner, d.accountId); if (a.platform !== d.platform) throw new PublishingError("ACCOUNT_MISMATCH", "Choose the correct account for this platform.");
      const invalid = validateDestination(d, media).filter((i) => i.severity === "error"); if (invalid.length) throw new PublishingError("INVALID_POST", invalid[0].message);
      if (!draft) {
        if (((d.platform === "instagram" && config.instagramDelivery === "public_url") || (d.platform === "pinterest" && config.pinterestCover === "public_url")) && (!config.deliveryEnabled || !config.publicOrigin)) throw new PublishingError("VIDEO_DELIVERY_UNAVAILABLE", "This destination’s media delivery is temporarily unavailable.", 503);
        const capability = await client.capability(d.platform); if (!capability.available) throw new PublishingError("VIDEO_UNAVAILABLE", capability.reason, 409);
        const verified = await client.verifyAccount(a); store.putAccount(verified); if (verified.status !== "connected") throw new PublishingError("RECONNECT_REQUIRED", "Reconnect this account before publishing.", 409);
        if (d.platform === "pinterest") { const b = await client.execute(verified, "PINTEREST_GET_BOARD", { board_id: d.pinterest!.boardId }, false); if (b.id !== d.pinterest!.boardId) throw new PublishingError("BOARD_UNAVAILABLE", "Choose an available Pinterest board.", 409); }
      }
    }
    return destinations;
  };
  return {
    async workspace(owner: Owner) {
      const posts = [];
      for (const p of store.list(owner)) { try { await storage.getProject(owner, p.export.ref.projectId); posts.push(postView(p)); } catch {} }
      return { accounts: store.listAccounts(owner).map(accountView), posts, exports: await listCompletedExports(storage, owner), capabilities: await Promise.all(PLATFORMS.map((p) => client.capability(p))), publishingReady: Boolean(config.enabled && config.apiKey && store.workerReady()), connectionReady: Boolean(config.apiKey && config.appOrigin) };
    },
    async inspect(owner: Owner, body: Record<string, unknown>) { exact(body, ["ref"]); return publicExport(await resolveCompletedExport(storage, owner, parseExportRef(body.ref), config.ffprobe)); },
    async preview(owner: Owner, body: Record<string, unknown>) {
      exact(body, ["ref", "destinations", "schedule"]); const resolved = await resolveCompletedExport(storage, owner, parseExportRef(body.ref), config.ffprobe), media = publicExport(resolved);
      const inputs = await verifyInputs(owner, body.destinations, resolved, false);
      const summaries = await Promise.all(inputs.map(async (d) => { const account = store.account(owner, d.accountId); const board = d.platform === "pinterest" ? await client.execute(account, "PINTEREST_GET_BOARD", { board_id: d.pinterest!.boardId }, false) : null; return { accountId: d.accountId, identity: account.identity, board: board ? { name: typeof board.name === "string" ? board.name.slice(0, 200) : "Selected board", privacy: typeof board.privacy === "string" ? board.privacy : "UNKNOWN" } : null }; }));
      return { media, schedule: resolveSchedule(schedule(body.schedule)), validation: inputs.map((d) => ({ accountId: d.accountId, issues: validateDestination(d, media) })), summaries };
    },
    async create(owner: Owner, body: Record<string, unknown>) {
      exact(body, ["ref", "expectedSha256", "destinations", "schedule", "idempotencyKey", "saveDraft"]);
      if (body.saveDraft !== undefined && typeof body.saveDraft !== "boolean") throw new PublishingError("INVALID_REQUEST", "Choose valid post settings.");
      const draft = body.saveDraft === true; if (!draft) requireReady();
      const resolved = await resolveCompletedExport(storage, owner, parseExportRef(body.ref), config.ffprobe), media = publicExport(resolved);
      if (body.expectedSha256 !== media.mediaContentSha256) throw new PublishingError("EXPORT_CHANGED", "Inspect the current completed export before submitting this post.", 409);
      const inputs = await verifyInputs(owner, body.destinations, resolved, draft);
      return postView(store.create(owner, media, inputs, resolveSchedule(schedule(body.schedule)), typeof body.idempotencyKey === "string" ? body.idempotencyKey : "", draft));
    },
    async revise(owner: Owner, id: string, body: Record<string, unknown>) {
      exact(body, ["revision", "destinations", "schedule", "saveDraft"]); if (body.saveDraft !== undefined && typeof body.saveDraft !== "boolean") throw new PublishingError("INVALID_REQUEST", "Choose valid post settings."); const p = await ownedPost(owner, id); const draft = body.saveDraft === true; if (!draft) requireReady();
      const actual = await resolveCompletedExport(storage, owner, p.export.ref, config.ffprobe); if (actual.mediaContentSha256 !== p.export.mediaContentSha256) throw new PublishingError("EXPORT_CHANGED", "The video changed. Create a new post from the current export.", 409);
      return postView(store.revise(owner, id, revision(body.revision), await verifyInputs(owner, body.destinations, actual, draft), resolveSchedule(schedule(body.schedule)), draft));
    },
    async cancel(owner: Owner, id: string, body: Record<string, unknown>) { exact(body, ["revision"]); await ownedPost(owner, id); return postView(store.cancel(owner, id, revision(body.revision))); },
    async cancelDestination(owner: Owner, id: string, destinationId: string, body: Record<string, unknown>) { exact(body, ["revision"]); await ownedPost(owner, id); return postView(store.cancelDestination(owner, id, destinationId, revision(body.revision))); },
    async destinationAction(owner: Owner, id: string, destinationId: string, action: "retry" | "reconcile") { requireReady(); await ownedPost(owner, id); return postView(action === "retry" ? store.retry(owner, id, destinationId) : store.reconcile(owner, id, destinationId)); },
    async connect(owner: Owner, body: Record<string, unknown>) {
      exact(body, ["platform", "reconnectAccountId"]); if (!isPlatform(body.platform) || (body.reconnectAccountId !== undefined && (typeof body.reconnectAccountId !== "string" || !ID.test(body.reconnectAccountId)))) throw new PublishingError("INVALID_PLATFORM", "Choose a supported platform.");
      if (!config.appOrigin) throw new PublishingError("SETUP_REQUIRED", "Connections are being set up. Check back soon.", 503);
      if (owner.dev && process.env.NODE_ENV === "production") throw new PublishingError("SIGN_IN_REQUIRED", "Sign in before connecting a social account.", 401);
      const capability = await client.capability(body.platform); if (!capability.available) throw new PublishingError("VIDEO_UNAVAILABLE", capability.reason, 409);
      const replaces = typeof body.reconnectAccountId === "string" && store.account(owner, body.reconnectAccountId).identity ? body.reconnectAccountId : undefined;
      const id = randomUUID(), { state } = store.beginConnection(owner, body.platform, id, replaces);
      const callback = new URL("/api/publishing/connections/callback", config.appOrigin); callback.searchParams.set("state", state);
      const result = await client.link(owner, body.platform, callback.href);
      const account: Account = { id, ownerId: owner.id, platform: body.platform, providerAccountId: result.providerAccountId, providerUserId: result.providerUserId, authConfigId: result.authConfigId, status: "connecting", identity: null, requestedScopes: [], verifiedAt: null, createdAt: Date.now() };
      // redirectUrl is intentionally transient, never stored with account credentials or returned in account views.
      store.putAccount(account);
      return { redirectUrl: result.redirectUrl };
    },
    async callback(owner: Owner, state: string) { const attempt = store.connection(owner, state), pending = store.account(owner, attempt.accountId); const verified = await client.verifyAccount(pending); if (verified.status !== "connected") throw new PublishingError("CONNECTION_INCOMPLETE", "Finish connecting this account, then return to Publishing.", 409); return accountView(store.completeConnection(owner, state, verified)); },
    async refresh(owner: Owner, id: string) { const account = store.account(owner, id); if (account.status === "disconnected") return accountView(account); try { const current = await client.verifyAccount(account); store.putAccount(current); return accountView(current); } catch (error) { if (error instanceof ProviderFault && error.code === "RECONNECT_REQUIRED") { const current = { ...account, status: "reconnect_required" as const }; store.putAccount(current); return accountView(current); } throw error; } },
    async disconnect(owner: Owner, id: string) { const a = store.account(owner, id), affected = store.accountDestinations(owner, id); store.disconnect(owner, id); await stopDeliveryStreams(owner, undefined, affected); await client.disconnect(a); return { disconnected: true }; },
    async boards(owner: Owner, id: string, bookmark?: string) { return client.boards(store.account(owner, id), bookmark); },
  };
}
