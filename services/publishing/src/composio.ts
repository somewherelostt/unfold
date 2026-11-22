import { createHash } from "node:crypto";
import { createReadStream, openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { TOOLKIT_VERSIONS, type PublishingConfig } from "./config.ts";
import { PublishingError, type Account, type Owner, type Platform } from "./types.ts";
export type JsonObject = Record<string, unknown>;
const object = (v: unknown): JsonObject => v && typeof v === "object" && !Array.isArray(v) ? v as JsonObject : {};
/** Live v3.1 uses JSON Schema; the reference also documents flat parameter maps. */
const schemaFields = (value: unknown): JsonObject => { const schema = object(value); return schema.type === "object" ? object(schema.properties) : schema; };
const hasFields = (value: unknown, names: readonly string[]) => names.every((name) => Object.hasOwn(schemaFields(value), name));
const numericId = (v: unknown): string | null => typeof v === "string" && /^\d{1,40}$/.test(v) ? v : null;
export { object, numericId };
export class ProviderFault extends Error {
  constructor(public code: string, message: string, public outcome: "rejected" | "ambiguous" | "read_failed", public retryable = false, public httpStatus?: number) { super(message); this.name = "ProviderFault"; }
}
export const TOOL_SPECS = {
  instagram: {
    INSTAGRAM_GET_USER_INFO: ["ig_user_id", "fields"],
    INSTAGRAM_POST_IG_USER_MEDIA: ["ig_user_id", "media_type", "video_url", "video_file", "caption", "share_to_feed", "thumb_offset"],
    INSTAGRAM_GET_MULTIPLE_NODES: ["object_ids", "fields"],
    INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH: ["ig_user_id", "creation_id", "max_wait_seconds"],
    INSTAGRAM_GET_IG_MEDIA: ["ig_media_id", "fields"],
  },
  pinterest: {
    PINTEREST_GET_PROFILE: [], PINTEREST_LIST_BOARDS: ["page_size", "bookmark"], PINTEREST_GET_BOARD: ["board_id"], PINTEREST_REGISTER_MEDIA: ["media_type"],
    PINTEREST_GET_MEDIA: ["media_id"], PINTEREST_CREATE_PIN: ["board_id", "title", "description", "alt_text", "link", "media_source"], PINTEREST_GET_PIN: ["pin_id"],
  },
} as const;
export type Capability = { platform: Platform; videoSupported: boolean; available: boolean; reason: string; checkedAt: number | null };
/** Small REST-only adapter. Fixed API origin, pinned tool versions, no SDK or arbitrary tool execution. */
export class ComposioClient {
  private verified = new Map<Platform, { until: number; result: Capability }>();
  private checking = new Map<Platform, Promise<Capability>>();
  private preparing = new Map<Platform, Promise<string>>();
  constructor(private config: PublishingConfig, private fetcher: typeof fetch = fetch) {}
  userId(owner: Owner) { return `unfold_${createHash("sha256").update(`${this.config.instanceId}\0${owner.id}`).digest("hex")}`; }
  private async request(endpoint: string, method: "GET" | "POST" | "DELETE", body?: unknown, mutation = false): Promise<JsonObject> {
    if (!this.config.apiKey) throw new PublishingError("SETUP_REQUIRED", "Social connections are not configured yet.", 503);
    let response: Response;
    try { response = await this.fetcher(`https://backend.composio.dev/api/v3.1${endpoint}`, { method, headers: { "x-api-key": this.config.apiKey, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000), redirect: "error", cache: "no-store" }); }
    catch { throw new ProviderFault("CONNECTION_INTERRUPTED", mutation ? "The platform may have received this request. Verifying its result before another attempt." : "The platform could not be reached. Try again shortly.", mutation ? "ambiguous" : "read_failed", !mutation); }
    if (!response.ok) {
      // Do not expose raw upstream bodies: they may contain tokens or signed media URLs.
      const rejected = [400, 401, 403, 404, 422, 429].includes(response.status);
      const code = [401, 403].includes(response.status) ? "CONNECTION_SERVICE_UNAVAILABLE" : response.status === 429 ? "RATE_LIMITED" : "PLATFORM_REQUEST_FAILED";
      const message = code === "CONNECTION_SERVICE_UNAVAILABLE" ? "Account connections are temporarily unavailable. Try again later or contact support." : code === "RATE_LIMITED" ? "The platform’s request limit was reached. Try again later." : "The platform could not complete this request. Check the account and post settings.";
      throw new ProviderFault(code, message, mutation ? rejected ? "rejected" : "ambiguous" : "read_failed", rejected && [401, 403, 429].includes(response.status), response.status);
    }
    try { return object(await response.json()); }
    catch { throw new ProviderFault("INVALID_RECEIPT", "The platform returned an incomplete result. Its status needs verification.", mutation ? "ambiguous" : "read_failed"); }
  }
  async capability(platform: Platform): Promise<Capability> {
    if (platform === "bluesky") return { platform, videoSupported: false, available: false, reason: "Video publishing is not supported by this connection.", checkedAt: null };
    if (!this.config.apiKey) return { platform, videoSupported: true, available: false, reason: "Account connection is currently unavailable. Try again later or contact support.", checkedAt: null };
    const prior = this.verified.get(platform); if (prior && prior.until > Date.now()) return prior.result;
    const checking = this.checking.get(platform); if (checking) return checking;
    const work = (async (): Promise<Capability> => { try {
      await Promise.all(Object.entries(TOOL_SPECS[platform]).map(async ([slug, keys]) => {
        const tool = await this.request(`/tools/${slug}?version=${TOOLKIT_VERSIONS[platform]}`, "GET");
        const parameters = schemaFields(tool.input_parameters);
        if (tool.slug !== slug || tool.version !== TOOLKIT_VERSIONS[platform] || tool.is_deprecated === true || object(tool.toolkit).slug !== platform || !hasFields(tool.input_parameters, keys)) throw new PublishingError("CAPABILITY_CHANGED", "This platform’s video connection needs an update.", 503);
        if (slug === "INSTAGRAM_POST_IG_USER_MEDIA" && this.config.instagramDelivery === "staged_file" && !hasFields(parameters.video_file, ["name", "mimetype", "s3key"])) throw new PublishingError("CAPABILITY_CHANGED", "This platform’s video upload connection needs an update.", 503);
        if (slug === "PINTEREST_CREATE_PIN") {
          const source = object(parameters.media_source), variants = Array.isArray(source.oneOf) ? source.oneOf : [source];
          const cover = this.config.pinterestCover === "key_frame" ? "cover_image_key_frame_time" : "cover_image_url";
          if (!variants.some((variant) => object(schemaFields(variant).source_type).const === "video_id" && hasFields(variant, ["media_id", cover]))) throw new PublishingError("CAPABILITY_CHANGED", "This platform’s video upload connection needs an update.", 503);
        }
      }));
      const result = { platform, videoSupported: true, available: true, reason: "Video publishing available. Account eligibility and media checks still apply.", checkedAt: Date.now() }; this.verified.set(platform, { until: Date.now() + 300_000, result }); return result;
    } catch { const result = { platform, videoSupported: true, available: false, reason: "This platform’s video connection could not be verified. Try again shortly.", checkedAt: Date.now() }; this.verified.set(platform, { until: Date.now() + 30_000, result }); return result; } })();
    this.checking.set(platform, work); try { return await work; } finally { this.checking.delete(platform); }
  }
  /** App-owned minimal managed OAuth config. Reuses a matching feature config after process restart. */
  async prepareAuthConfig(platform: "instagram" | "pinterest"): Promise<string> {
    const configured = this.config.authConfigs[platform]; if (configured) return configured;
    const pending = this.preparing.get(platform); if (pending) return pending;
    const work = (async () => {
      const toolkit = await this.request(`/toolkits/${platform}?version=${TOOLKIT_VERSIONS[platform]}`, "GET");
      const managed = (Array.isArray(toolkit.composio_managed_auth) ? toolkit.composio_managed_auth : []).map(object).find((a) => String(a.mode).toUpperCase() === "OAUTH2" && a.is_default === true);
      if (toolkit.slug !== platform || !managed) throw new PublishingError("MANAGED_CONNECTION_UNAVAILABLE", "This platform’s video connection requires additional setup by the app administrator.", 503);
      const required = platform === "instagram" ? ["instagram_business_basic", "instagram_business_content_publish"] : ["boards:read", "pins:read", "pins:write", "user_accounts:read"];
      const available = object(managed.scopes).available;
      const defaults = (Array.isArray(toolkit.auth_config_details) ? toolkit.auth_config_details : []).map(object).filter((a) => a.mode === "OAUTH2").flatMap((a) => { const fields = object(object(a.fields).auth_config_creation); return [...(Array.isArray(fields.required) ? fields.required : []), ...(Array.isArray(fields.optional) ? fields.optional : [])].map(object).filter((f) => f.name === "scopes" && typeof f.default === "string").flatMap((f) => String(f.default).split(",").map((s) => s.trim()).filter(Boolean)); });
      // An empty available list is unspecified for some live toolkits. Require explicit default-scope evidence instead.
      const supported = Array.isArray(available) && available.length ? available : defaults;
      if (required.some((scope) => !supported.includes(scope))) throw new PublishingError("PUBLISH_ACCESS_UNAVAILABLE", "This connection does not offer the access required to publish video. Contact the app administrator.", 503);
      const name = `Unfold publishing ${platform} ${createHash("sha256").update(this.config.instanceId).digest("hex").slice(0, 12)}`;
      const allowedTools = Object.keys(TOOL_SPECS[platform]);
      const existing = await this.request(`/auth_configs?toolkit_slug=${platform}&is_composio_managed=true&search=${encodeURIComponent(name)}&limit=200`, "GET");
      const match = (Array.isArray(existing.items) ? existing.items : []).map(object).find((a) => { const restrictions = Array.isArray(a.restrict_to_following_tools) ? a.restrict_to_following_tools : []; return a.name === name && a.status === "ENABLED" && a.auth_scheme === "OAUTH2" && a.is_composio_managed === true && object(a.toolkit).slug === platform && allowedTools.every((tool) => restrictions.includes(tool)) && restrictions.length === allowedTools.length; });
      let id = typeof match?.id === "string" ? match.id : null;
      if (!id) {
        const created = await this.request("/auth_configs", "POST", { toolkit: { slug: platform }, auth_config: { type: "use_composio_managed_auth", name, credentials: { scopes: required.join(",") }, restrict_to_following_tools: allowedTools, ...(typeof managed.managed_app_id === "string" ? { managed_app_id: managed.managed_app_id } : {}) } }, true);
        id = typeof object(created.auth_config).id === "string" ? String(object(created.auth_config).id) : null;
      }
      if (!id || !/^ac_[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PublishingError("CONFIGURATION_UNCONFIRMED", "This platform’s connection setup could not be confirmed. Try again shortly.", 503);
      this.config.authConfigs[platform] = id; return id;
    })();
    this.preparing.set(platform, work); try { return await work; } finally { this.preparing.delete(platform); }
  }
  /** Operator-only catalog discovery; safe metadata only. Never treats a text tool as video support. */
  async inspectBlueskyCatalog() {
    try { await this.request("/toolkits/bluesky", "GET"); }
    catch (error) { if (error instanceof ProviderFault && error.httpStatus === 404) return { toolkitExists: false, tools: [] }; throw error; }
    const result = await this.request("/tools?toolkit_slug=bluesky&query=video&limit=100", "GET");
    return { toolkitExists: true, tools: (Array.isArray(result.items) ? result.items : []).map(object).map((t) => ({ slug: String(t.slug), version: String(t.version), inputKeys: Object.keys(schemaFields(t.input_parameters)) })) };
  }
  /** Explicit staging of an already owner-verified export. No arbitrary paths are accepted by the HTTP API. */
  async stageInstagramVideo(absolutePath: string, filename: string, onPrepared: (id: string) => void) {
    if (!/^[A-Za-z0-9_-]{1,100}\.mp4$/.test(filename)) throw new PublishingError("INVALID_FILE", "Invalid video upload reference.");
    const before = await stat(absolutePath); if (!before.isFile() || before.size < 1 || before.size > 300_000_000) throw new PublishingError("INVALID_FILE", "Choose a completed MP4 of up to 300 MB.");
    const md5 = createHash("md5"); for await (const chunk of createReadStream(absolutePath)) md5.update(chunk);
    const after = await stat(absolutePath); if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw new PublishingError("EXPORT_CHANGED", "The video changed before upload. Inspect it again.", 409);
    const result = await this.request("/files/upload/request", "POST", { toolkit_slug: "instagram", tool_slug: "INSTAGRAM_POST_IG_USER_MEDIA", filename, mimetype: "video/mp4", md5: md5.digest("hex") }, true);
    if (typeof result.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(result.id) || typeof result.key !== "string" || !result.key || result.key.length > 4096 || /[\x00-\x1f]/.test(result.key) || typeof result.new_presigned_url !== "string") throw new ProviderFault("UPLOAD_UNCONFIRMED", "The video upload reference could not be confirmed.", "ambiguous");
    const url = new URL(result.new_presigned_url);
    const aws = url.hostname === "s3.amazonaws.com" || /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) || /^[a-z0-9][a-z0-9.-]*\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname);
    if (!aws || url.protocol !== "https:" || url.username || url.password || url.port) throw new PublishingError("UPLOAD_UNAVAILABLE", "The video upload destination could not be verified.", 502);
    onPrepared(result.id);
    // A file-backed Blob streams bytes while letting fetch compute Content-Length, matching the official upload contract.
    const blob = await openAsBlob(absolutePath, { type: "video/mp4" });
    let uploaded: Response;
    try { uploaded = await this.fetcher(url, { method: "PUT", body: blob, headers: { "Content-Type": "video/mp4" }, redirect: "error", signal: AbortSignal.timeout(120_000) }); }
    catch { throw new ProviderFault("UPLOAD_INTERRUPTED", "The video upload was interrupted. Its result needs verification.", "ambiguous"); }
    if (!uploaded.ok) throw new ProviderFault("UPLOAD_FAILED", "The video upload was not accepted. Try this destination again later.", [400, 401, 403, 411, 413, 422].includes(uploaded.status) ? "rejected" : "ambiguous", [400, 401, 403, 411, 422].includes(uploaded.status));
    // The signed URL and storage key are transient; the operation journal retains only the provider file ID.
    return { id: result.id, file: { name: filename, mimetype: "video/mp4" as const, s3key: result.key } };
  }
  async link(owner: Owner, platform: Platform, callbackUrl: string) {
    if (platform === "bluesky") throw new PublishingError("VIDEO_UNAVAILABLE", "This platform’s video connection is unavailable.", 409);
    const authConfigId = await this.prepareAuthConfig(platform);
    const auth = await this.request(`/auth_configs/${encodeURIComponent(authConfigId)}`, "GET");
    if (object(auth.toolkit).slug !== platform || auth.status !== "ENABLED" || auth.auth_scheme !== "OAUTH2") throw new PublishingError("CONFIG", "This connection is not ready. Contact the app administrator.", 503);
    const result = await this.request("/connected_accounts/link", "POST", { auth_config_id: authConfigId, user_id: this.userId(owner), callback_url: callbackUrl }, true);
    if (typeof result.connected_account_id !== "string" || !/^ca_[A-Za-z0-9_-]{1,100}$/.test(result.connected_account_id) || typeof result.redirect_url !== "string") throw new ProviderFault("INVALID_CONNECTION", "A connection link could not be created. Try again.", "ambiguous");
    const url = new URL(result.redirect_url);
    if (url.protocol !== "https:" || url.hostname !== "connect.composio.dev" || url.username || url.password) throw new PublishingError("INVALID_CONNECTION", "An invalid connection link was returned.", 502);
    return { providerAccountId: result.connected_account_id, redirectUrl: url.href, authConfigId, providerUserId: this.userId(owner) };
  }
  async verifyAccount(account: Account): Promise<Account> {
    const remote = await this.request(`/connected_accounts/${encodeURIComponent(account.providerAccountId)}`, "GET");
    if (remote.id !== account.providerAccountId || remote.user_id !== account.providerUserId || object(remote.toolkit).slug !== account.platform || object(remote.auth_config).id !== account.authConfigId || object(remote.experimental).account_type === "SHARED") throw new PublishingError("ACCOUNT_MISMATCH", "This account could not be verified.", 403);
    const requestedScopes = Array.isArray(remote.requested_scopes) ? remote.requested_scopes.filter((s): s is string => typeof s === "string" && s.length < 200) : [];
    if (remote.status !== "ACTIVE" || remote.is_disabled) return { ...account, requestedScopes, status: ["INITIATED", "INITIALIZING"].includes(String(remote.status)) ? "connecting" : "reconnect_required" };
    const profile = await this.execute(account, account.platform === "instagram" ? "INSTAGRAM_GET_USER_INFO" : "PINTEREST_GET_PROFILE", account.platform === "instagram" ? { ig_user_id: "me", fields: "id,username,name,account_type" } : {}, false);
    const handle = typeof profile.username === "string" ? profile.username : "";
    if (!handle || handle.length > 200 || (account.platform === "instagram" && !numericId(profile.id))) throw new PublishingError("IDENTITY_UNAVAILABLE", "The connected account’s identity could not be verified.", 409);
    const accountType = typeof profile.account_type === "string" ? profile.account_type : undefined;
    if (account.platform === "instagram" && !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(accountType ?? "")) throw new PublishingError("PROFESSIONAL_ACCOUNT_REQUIRED", "Connect an Instagram Business or Creator account. Personal accounts cannot publish through this connection.", 409);
    return { ...account, status: "connected", requestedScopes, identity: { id: String(profile.id ?? handle), handle, name: typeof profile.name === "string" ? profile.name.slice(0, 200) : typeof profile.business_name === "string" ? profile.business_name.slice(0, 200) : handle, ...(accountType ? { accountType } : {}) }, verifiedAt: Date.now() };
  }
  async execute(account: Account, slug: string, args: JsonObject, mutation: boolean): Promise<JsonObject> {
    if (account.platform === "bluesky" || !Object.hasOwn(TOOL_SPECS[account.platform], slug)) throw new PublishingError("UNSUPPORTED_ACTION", "This publishing action is unavailable.", 409);
    const result = await this.request(`/tools/execute/${slug}`, "POST", { connected_account_id: account.providerAccountId, user_id: account.providerUserId, version: TOOLKIT_VERSIONS[account.platform], arguments: args }, mutation);
    if (result.successful !== true) throw new ProviderFault("PLATFORM_RESULT_UNCONFIRMED", mutation ? "The platform did not confirm this request. Its result needs verification before trying again." : "The platform could not return this account’s information.", mutation ? "ambiguous" : "read_failed", !mutation);
    return object(result.data);
  }
  async disconnect(account: Account) {
    // Remove provider-managed credentials as well as the app-owned mapping.
    await this.request(`/connected_accounts/${encodeURIComponent(account.providerAccountId)}`, "DELETE", undefined, true);
  }
  async boards(account: Account, bookmark?: string) {
    if (account.platform !== "pinterest") throw new PublishingError("INVALID_ACCOUNT", "Choose a Pinterest account.");
    const result = await this.execute(account, "PINTEREST_LIST_BOARDS", { page_size: 100, ...(bookmark ? { bookmark } : {}) }, false);
    return { items: (Array.isArray(result.items) ? result.items : []).map(object).filter((b) => numericId(b.id) && typeof b.name === "string").map((b) => ({ id: String(b.id), name: String(b.name).slice(0, 200), privacy: String(b.privacy ?? "UNKNOWN") })), bookmark: typeof result.bookmark === "string" ? result.bookmark : null };
  }
}
