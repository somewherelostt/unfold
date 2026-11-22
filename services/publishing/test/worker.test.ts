import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { PublishingStore } from "../src/store.ts";
import { Publisher } from "../src/dispatch.ts";
import { ComposioClient } from "../src/composio.ts";
import { loadPublishingConfig } from "../src/config.ts";
import { runPublishingWorker } from "../src/worker.ts";
import type { Account, CompletedExport } from "../src/types.ts";

test("supervised worker resumes a persisted future schedule after stopping, with no browser dependency", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-publishing-worker-")), file = path.join(root, "publishing.sqlite"); let now = Date.now();
  let store = new PublishingStore(file, () => now), publishCalls = 0;
  const owner = { id: "owner" }, account: Account = { id: "account", ownerId: owner.id, platform: "instagram", providerAccountId: "ca_fixture", providerUserId: "fixture", authConfigId: "ac_fixture", identity: { id: "123", name: "Fixture", handle: "fixture" }, status: "connected", requestedScopes: [], verifiedAt: now, createdAt: now };
  const media: CompletedExport = { ref: { projectId: "project", fileKey: "export.mp4" }, mediaContentSha256: "a".repeat(64), previewUrl: "/fixture.mp4", properties: { bytes: 1000, duration: 12, width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac", mime: "video/mp4" } };
  class FixtureClient extends ComposioClient {
    override async stageInstagramVideo(_path: string, filename: string, onPrepared: (id: string) => void) { onPrepared("file_fixture"); return { id: "file_fixture", file: { name: filename, mimetype: "video/mp4" as const, s3key: "private-fixture-key" } }; }
    override async verifyAccount(a: Account) { return a; }
    override async execute(_a: Account, slug: string) {
      if (slug === "INSTAGRAM_POST_IG_USER_MEDIA") return { id: "456" };
      if (slug === "INSTAGRAM_GET_MULTIPLE_NODES") return { "456": { id: "456", status_code: "FINISHED" } };
      if (slug === "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH") { publishCalls++; return { id: "789" }; }
      if (slug === "INSTAGRAM_GET_IG_MEDIA") return { id: "789", permalink: "https://www.instagram.com/reel/fixture/" };
      throw Error("Unexpected fixture action");
    }
  }
  const createPublisher = () => new Publisher(store, new FixtureClient(loadPublishingConfig(root, {})), { open: async () => ({ absolutePath: "/fixture.mp4", release: async () => {} }), videoUrl: async () => "https://fixture.invalid/video", coverUrl: async () => "https://fixture.invalid/cover" });
  let stop = new AbortController(), running: Promise<void> | null = null;
  try {
    store.putAccount(account);
    const post = store.create(owner, media, [{ accountId: account.id, platform: "instagram", text: "Scheduled fixture", instagram: { shareToFeed: false, thumbnailMs: 0 } }], { mode: "scheduled", at: now + 60_000, localDateTime: new Date(now + 60_000).toISOString().slice(0, 16), timeZone: "UTC", offsetMinutes: 0 }, "scheduled-fixture");
    running = runPublishingWorker(store, createPublisher(), stop.signal); await delay(20); stop.abort(); await running; running = null;
    assert.equal(store.get(owner, post.id).destinations[0].state, "scheduled"); store.close();
    now += 60_001; store = new PublishingStore(file, () => now); stop = new AbortController(); running = runPublishingWorker(store, createPublisher(), stop.signal);
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && store.get(owner, post.id).destinations[0].state !== "published") { now += 60_001; await delay(50); }
    assert.equal(store.get(owner, post.id).destinations[0].state, "published"); assert.equal(publishCalls, 1);
  } finally { stop.abort(); await running; store.close(); await rm(root, { recursive: true, force: true }); }
});
