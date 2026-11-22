import path from "node:path";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Owner } from "../private-storage.ts";
import { loadPublishingConfig } from "../../../../../services/publishing/src/config.ts";
import { ComposioClient } from "../../../../../services/publishing/src/composio.ts";
import { Publisher } from "../../../../../services/publishing/src/dispatch.ts";
import { createPublishingRepository } from "../../../../../services/publishing/src/repository.ts";
import { createPrivateStorage } from "../storage-factory.ts";
import { createPublishingMedia, stopDeliveryStreams } from "./media.ts";
export function createPublishingRuntime(repoRoot: string, env = process.env) {
  const config = loadPublishingConfig(repoRoot, env), storage = createPrivateStorage(path.join(env.UNFOLD_DATA_DIR ?? path.join(repoRoot, "data"), "private-v1"));
  const store = createPublishingRepository(config.databasePath), client = new ComposioClient(config), media = createPublishingMedia(storage, store, config), publisher = new Publisher(store, client, media, undefined, config);
  return {
    config, storage, store, client, publisher,
    async beginProjectDeletion(owner: Owner, projectId: string) { await storage.getProject(owner, projectId); const result = await store.beginDeletion(owner, projectId); await stopDeliveryStreams(owner, projectId); return result; },
    async beginOwnerDeletion(owner: Owner) { const result = await store.beginDeletion(owner); await stopDeliveryStreams(owner); return result; },
    async finalizeProjectDeletion(owner: Owner, projectId: string) { await store.finalizeDeletion(owner, projectId); await rm(path.join(config.coverRoot, createHash("sha256").update(owner.id).digest("hex"), projectId), { recursive: true, force: true }); },
  };
}
export type PublishingRuntime = ReturnType<typeof createPublishingRuntime>;
let runtime: PublishingRuntime | null = null;
export function getPublishingRuntime() { return runtime ??= createPublishingRuntime(process.env.UNFOLD_REPO_ROOT ?? path.resolve(process.cwd(), "../..")); }
