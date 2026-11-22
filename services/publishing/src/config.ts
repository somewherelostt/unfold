import path from "node:path";
import { PublishingError, type Platform } from "./types.ts";
export const TOOLKIT_VERSIONS = { instagram: "20261112_00", pinterest: "20261101_00" } as const;
export type PublishingConfig = {
  databasePath: string; coverRoot: string; apiKey: string | null; publicOrigin: string | null; appOrigin: string | null; deliveryTtlMs: number;
  authConfigs: Partial<Record<Platform, string>>; enabled: boolean; deliveryEnabled: boolean; instanceId: string;
  ffmpeg: string; ffprobe: string;
  instagramDelivery: "staged_file" | "public_url"; pinterestCover: "key_frame" | "public_url";
};
export function loadPublishingConfig(repoRoot = process.cwd(), env: NodeJS.ProcessEnv = process.env): PublishingConfig {
  let publicOrigin: string | null = null;
  if (env.UNFOLD_PUBLISHING_PUBLIC_ORIGIN) {
    const u = new URL(env.UNFOLD_PUBLISHING_PUBLIC_ORIGIN);
    if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/" || u.search || u.hash || /^(localhost|127\.|\[?::1)/.test(u.hostname)) throw new PublishingError("CONFIG", "Configure a public HTTPS publishing origin.", 503);
    publicOrigin = u.origin;
  }
  const authConfigs: PublishingConfig["authConfigs"] = {};
  for (const platform of ["instagram", "pinterest"] as const) {
    const id = env[`UNFOLD_PUBLISHING_${platform.toUpperCase()}_AUTH_CONFIG`];
    if (id) { if (!/^ac_[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PublishingError("CONFIG", "Invalid social connection configuration.", 503); authConfigs[platform] = id; }
  }
  const data = env.UNFOLD_DATA_DIR ?? path.join(repoRoot, "data");
  const instagramDelivery = env.UNFOLD_PUBLISHING_INSTAGRAM_DELIVERY ?? "staged_file", pinterestCover = env.UNFOLD_PUBLISHING_PINTEREST_COVER ?? "key_frame";
  if (!["staged_file", "public_url"].includes(instagramDelivery) || !["key_frame", "public_url"].includes(pinterestCover)) throw new PublishingError("CONFIG", "Invalid publishing media configuration.", 503);
  let appOrigin: string | null = publicOrigin;
  if (env.UNFOLD_PUBLISHING_APP_ORIGIN) { const u = new URL(env.UNFOLD_PUBLISHING_APP_ORIGIN); if (u.username || u.password || u.pathname !== "/" || u.search || u.hash || (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)))) throw new PublishingError("CONFIG", "Configure the trusted publishing app origin.", 503); appOrigin = u.origin; }
  const deliveryTtlMs = Number(env.UNFOLD_PUBLISHING_DELIVERY_TTL_SECONDS ?? "1800") * 1000;
  if (!Number.isSafeInteger(deliveryTtlMs) || deliveryTtlMs < 60_000 || deliveryTtlMs > 6 * 3_600_000) throw new PublishingError("CONFIG", "Invalid publishing media delivery lifetime.", 503);
  return { databasePath: path.join(data, "publishing-v1", "publishing.sqlite"), coverRoot: path.join(data, "publishing-v1", "covers"), apiKey: env.COMPOSIO_API_KEY?.trim() || null,
    publicOrigin, appOrigin, deliveryTtlMs, authConfigs, enabled: env.UNFOLD_PUBLISHING_ENABLED === "1", deliveryEnabled: env.UNFOLD_PUBLISHING_DELIVERY_ENABLED === "1",
    instanceId: env.UNFOLD_PUBLISHING_INSTANCE_ID ?? "unfold", ffmpeg: env.FFMPEG_PATH ?? "ffmpeg", ffprobe: env.FFPROBE_PATH ?? "ffprobe", instagramDelivery: instagramDelivery as PublishingConfig["instagramDelivery"], pinterestCover: pinterestCover as PublishingConfig["pinterestCover"] };
}
