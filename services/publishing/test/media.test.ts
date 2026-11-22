import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PrivateStorage } from "../../../apps/web/src/server/private-storage.ts";
import { ownedExportPath, parseExportRef, resolveCompletedExport } from "../../../apps/web/src/server/publishing/exports.ts";
import { servePublishingDelivery, stopDeliveryStreams } from "../../../apps/web/src/server/publishing/media.ts";
import { loadPublishingConfig } from "../src/config.ts";
import { PublishingStore } from "../src/store.ts";
import { resolveSchedule } from "../src/time.ts";
import type { Account } from "../src/types.ts";

test("registered SSE and job MP4 references enforce ownership, stream a content hash and omit invented settings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-publishing-media-")), owner = { id: "owner" };
  const storage = new PrivateStorage(path.join(root, "private"));
  try {
    await storage.createProject(owner, "project", "Fixture project");
    const directory = path.join(storage.projectDir("project"), "media", "exports"); await mkdir(directory, { recursive: true });
    const ref = { projectId: "project", fileKey: "export.mp4" }; await writeFile(path.join(directory, ref.fileKey), "fixture-video-bytes");
    await assert.rejects(ownedExportPath(storage, owner, ref)); await storage.registerReference(owner, "project", "exports", ref.fileKey);
    await assert.rejects(ownedExportPath(storage, { id: "other" }, ref)); assert.throws(() => parseExportRef({ projectId: "project", fileKey: "../export.mp4" }));
    // A bounded executable fixture replaces only ffprobe, never the owner/registry/hash implementation.
    const probe = path.join(root, "probe"); await writeFile(probe, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({format:{duration:"12",format_name:"mov,mp4,m4a,3gp,3g2,mj2"},streams:[{codec_type:"video",codec_name:"h264",width:1080,height:1920,avg_frame_rate:"30000/1000"}]}));\n'); await chmod(probe, 0o700);
    const resolved = await resolveCompletedExport(storage, owner, ref, probe);
    assert.equal(resolved.mediaContentSha256, createHash("sha256").update(await readFile(path.join(directory, ref.fileKey))).digest("hex")); assert.equal(resolved.settings, undefined); assert.equal(resolved.renderedPlanFingerprint, undefined);
    assert.equal(resolved.previewUrl, "/media/project/exports/export.mp4"); assert.equal((await storage.getProject(owner, "project")).leases && Object.keys((await storage.getProject(owner, "project")).leases).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("expiring delivery supports HEAD and single ranges, revokes an active stream and releases its lease", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-publishing-delivery-")), owner = { id: "owner" };
  const storage = new PrivateStorage(path.join(root, "private")), store = new PublishingStore(path.join(root, "publishing.sqlite"));
  try {
    await storage.createProject(owner, "project", "Fixture"); const directory = path.join(storage.projectDir("project"), "media", "exports"); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "fixture.mp4"), Buffer.alloc(1024 * 1024, 42)); await storage.registerReference(owner, "project", "exports", "fixture.mp4");
    const account: Account = { id: "account", ownerId: owner.id, platform: "instagram", providerAccountId: "ca_fixture", providerUserId: "fixture", authConfigId: "ac_fixture", identity: { id: "123", handle: "fixture", name: "Fixture" }, status: "connected", requestedScopes: [], verifiedAt: Date.now(), createdAt: Date.now() }; store.putAccount(account);
    const post = store.create(owner, { ref: { projectId: "project", fileKey: "fixture.mp4" }, mediaContentSha256: "a".repeat(64), properties: { bytes: 1024 * 1024, duration: 12, width: 1080, height: 1920, fps: 30, mime: "video/mp4", videoCodec: "h264", audioCodec: null }, previewUrl: "/media/project/exports/fixture.mp4" }, [{ accountId: "account", platform: "instagram", text: "Fixture", instagram: { shareToFeed: false, thumbnailMs: 0 } }], resolveSchedule({ mode: "now" }), "delivery-fixture");
    const claim = store.claim()!, grant = store.issueDelivery(claim.destination.id, claim.token, { kind: "video", fileKey: post.export.ref.fileKey }); const config = loadPublishingConfig(root, { UNFOLD_PUBLISHING_DELIVERY_ENABLED: "1" });
    const head = await servePublishingDelivery(new Request("https://fixture.invalid", { method: "HEAD" }), grant.capability, storage, store, config); assert.equal(head.status, 200); assert.equal(head.headers.get("Content-Length"), String(1024 * 1024)); assert.equal(head.body, null);
    const range = await servePublishingDelivery(new Request("https://fixture.invalid", { headers: { Range: "bytes=20-29" } }), grant.capability, storage, store, config); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 10);
    const invalid = await servePublishingDelivery(new Request("https://fixture.invalid", { headers: { Range: "bytes=1-2,3-4" } }), grant.capability, storage, store, config); assert.equal(invalid.status, 416);
    const body = await servePublishingDelivery(new Request("https://fixture.invalid"), grant.capability, storage, store, config), reader = body.body!.getReader(); assert.equal((await reader.read()).done, false);
    store.disconnect(owner, "account"); let failed = false; try { while (!(await reader.read()).done) {} } catch { failed = true; } assert.equal(failed, true);
    // Stream cleanup runs through the real storage lease release.
    await stopDeliveryStreams(owner, "project"); assert.equal(Object.keys((await storage.getProject(owner, "project")).leases).length, 0);
    await assert.rejects(servePublishingDelivery(new Request("https://fixture.invalid"), grant.capability, storage, store, config));
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
