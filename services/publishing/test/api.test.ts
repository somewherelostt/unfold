import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createPublishingRuntime } from "../../../apps/web/src/server/publishing/runtime.ts";
import { createPublishingApi, publishingBody, requireSameOrigin } from "../../../apps/web/src/server/publishing/api.ts";
import { ComposioClient } from "../src/composio.ts";
import { loadPublishingConfig } from "../src/config.ts";
import { uploadPinterestVideo } from "../src/dispatch.ts";

test("API accepts only an inspected registered owned export and keeps privileged mappings out of workspace JSON", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-publishing-api-")), owner = { id: "owner" };
  const probe = path.join(root, "probe"); await writeFile(probe, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({format:{duration:"12",format_name:"mp4"},streams:[{codec_type:"video",codec_name:"h264",width:1080,height:1920,avg_frame_rate:"30/1"}]}));\n'); await chmod(probe, 0o700);
  const runtime = createPublishingRuntime(root, { UNFOLD_DATA_DIR: root, FFPROBE_PATH: probe }), api = createPublishingApi(runtime);
  try {
    await runtime.storage.createProject(owner, "project", "Fixture project"); const directory = path.join(runtime.storage.projectDir("project"), "media", "exports"); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, "export.mp4"), "fixture"); await runtime.storage.registerReference(owner, "project", "exports", "export.mp4");
    runtime.store.putAccount({ id: "account", ownerId: owner.id, platform: "instagram", providerAccountId: "ca_private", providerUserId: "private-user", authConfigId: "ac_private", identity: { id: "123", handle: "fixture", name: "Fixture" }, status: "connected", requestedScopes: [], verifiedAt: 1, createdAt: 1 });
    const ref = { projectId: "project", fileKey: "export.mp4" }, media = await api.inspect(owner, { ref });
    assert(!("absolutePath" in media)); assert.equal(media.settings, undefined);
    const body = { ref, expectedSha256: media.mediaContentSha256, destinations: [{ accountId: "account", platform: "instagram", text: "Draft", instagram: { shareToFeed: true, thumbnailMs: 0 } }], schedule: { mode: "now" }, idempotencyKey: "draft-submission", saveDraft: true };
    const saved = await api.create(owner, body); assert.equal(saved.destinations[0].state, "draft");
    await assert.rejects(api.create(owner, { ...body, connected_account_id: "ca_attacker" }), /Unexpected/);
    await assert.rejects(api.create(owner, { ...body, ownerId: "other" }), /Unexpected/);
    await assert.rejects(api.inspect({ id: "other" }, { ref }));
    await assert.rejects(api.create(owner, { ...body, expectedSha256: "wrong", idempotencyKey: "another-key" }), /Inspect the current/);
    await assert.rejects(api.create(owner, { ...body, saveDraft: false }), /temporarily paused/);
    const json = JSON.stringify(await api.workspace(owner)); assert(!json.includes("ca_private")); assert(!json.includes("ac_private")); assert(!json.includes(root)); assert(!json.includes("private-user"));
  } finally { runtime.store.close(); await rm(root, { recursive: true, force: true }); }
});
test("mutations require same-origin JSON requests and bounded settings", async () => {
  assert.throws(() => requireSameOrigin(new Request("https://unfold.invalid/api/publishing/posts", { headers: { Origin: "https://attacker.invalid" } }), "https://unfold.invalid"));
  assert.doesNotThrow(() => requireSameOrigin(new Request("https://unfold.invalid/api/publishing/posts", { headers: { Origin: "https://unfold.invalid" } }), "https://unfold.invalid"));
  await assert.rejects(publishingBody(new Request("https://unfold.invalid", { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" })));
  await assert.rejects(publishingBody(new Request("https://unfold.invalid", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "100001" }, body: "{}" })));
});
test("connected-account verification refuses cross-user and wrong-toolkit credentials", async () => {
  const config = loadPublishingConfig("/tmp", { COMPOSIO_API_KEY: "fixture-secret" });
  const client = new ComposioClient(config, async () => Response.json({ id: "ca_fixture", user_id: "someone-else", toolkit: { slug: "instagram" }, auth_config: { id: "ac_fixture" }, status: "ACTIVE" }));
  await assert.rejects(client.verifyAccount({ id: "account", ownerId: "owner", platform: "instagram", providerAccountId: "ca_fixture", providerUserId: "expected-owner", authConfigId: "ac_fixture", identity: null, status: "connecting", requestedScopes: [], verifiedAt: null, createdAt: 1 }), /could not be verified/);
});
test("Pinterest upload streams multipart bytes only to a pinned S3 host and never forwards social auth", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-publishing-upload-")), file = path.join(root, "video.mp4"); await writeFile(file, "fixture-video");
  try {
    let calls = 0;
    await uploadPinterestVideo({ upload_url: "https://fixture.s3.amazonaws.com/", upload_parameters: { key: "fixture-key", policy: "ephemeral-fixture-policy" } }, file, async (_url, init) => {
      calls++; const headers = new Headers(init?.headers); assert.equal(headers.get("authorization"), null); assert.equal(headers.get("x-api-key"), null);
      const body = await new Response(init?.body).text(); assert(body.includes("fixture-video")); assert(body.includes('name="policy"')); assert.equal(Number(headers.get("Content-Length")), Buffer.byteLength(body)); return new Response(null, { status: 204 });
    });
    assert.equal(calls, 1); await assert.rejects(uploadPinterestVideo({ upload_url: "https://127.0.0.1/", upload_parameters: { key: "fixture" } }, file));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("ordinary project deletion works with publishing fully unconfigured and no outbound network", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-publishing-delete-")), owner = { id: "owner" }, original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("No outbound network is allowed in this fixture"); };
  let runtime: ReturnType<typeof createPublishingRuntime> | undefined;
  try {
    runtime = createPublishingRuntime(root, { UNFOLD_DATA_DIR: root }); await runtime.storage.createProject(owner, "project", "Fixture");
    assert.equal(runtime.config.apiKey, null); assert.equal(runtime.config.publicOrigin, null); assert.equal(runtime.config.enabled, false);
    assert.deepEqual(await runtime.beginProjectDeletion(owner, "project"), { ready: true, unresolvedDestinationIds: [] });
    await runtime.storage.deleteProject(owner, "project"); await runtime.finalizeProjectDeletion(owner, "project"); await runtime.finalizeProjectDeletion(owner, "project"); assert.equal(calls, 0);
  } finally { runtime?.store.close(); globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});
test("Instagram staging matches the official presign/PUT contract without app hosting or credential forwarding", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-publishing-stage-")), file = path.join(root, "video.mp4"); await writeFile(file, "fixture-video"); let prepared = false;
  const client = new ComposioClient(loadPublishingConfig(root, { COMPOSIO_API_KEY: "fixture-secret" }), async (url, init) => {
    const headers = new Headers(init?.headers);
    if (String(url).startsWith("https://backend.composio.dev/")) {
      assert.equal(init?.method, "POST"); assert.equal(headers.get("x-api-key"), "fixture-secret"); const body = JSON.parse(String(init?.body));
      assert.equal(body.toolkit_slug, "instagram"); assert.equal(body.tool_slug, "INSTAGRAM_POST_IG_USER_MEDIA"); assert.equal(body.mimetype, "video/mp4"); assert.match(body.md5, /^[a-f0-9]{32}$/);
      return Response.json({ id: "file_fixture", key: "private-key", new_presigned_url: "https://fixture.s3.amazonaws.com/video.mp4?X-Amz-Signature=fixture" });
    }
    assert.equal(prepared, true); assert.equal(init?.method, "PUT"); assert.equal(headers.get("authorization"), null); assert.equal(headers.get("x-api-key"), null); assert.equal(headers.get("Content-Type"), "video/mp4"); assert.equal(await new Response(init?.body).text(), "fixture-video"); return new Response(null, { status: 200 });
  });
  try { const result = await client.stageInstagramVideo(file, "video.mp4", (id) => { assert.equal(id, "file_fixture"); prepared = true; }); assert.equal(result.file.s3key, "private-key"); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test("Instagram staging accepts returned Cloudflare R2 endpoints and rejects lookalikes before sending bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-publishing-r2-")), file = path.join(root, "video.mp4"); await writeFile(file, "fixture-video");
  const account = "0123456789abcdef0123456789abcdef";
  try {
    for (const [origin, allowed] of [[`https://temp.${account}.r2.cloudflarestorage.com`, true], [`https://${account}.r2.cloudflarestorage.com`, true], [`https://temp.${account}.r2.cloudflarestorage.com.attacker.invalid`, false], [`http://temp.${account}.r2.cloudflarestorage.com`, false], [`https://temp.${account}.r2.cloudflarestorage.com:8443`, false], ["https://127.0.0.1", false]] as const) {
      let prepared = false, uploads = 0;
      const client = new ComposioClient(loadPublishingConfig(root, { COMPOSIO_API_KEY: "fixture" }), async (url, init) => {
        if (String(url).startsWith("https://backend.composio.dev/")) return Response.json({ id: "file_fixture", key: "private-fixture-key", new_presigned_url: `${origin}/video.mp4?X-Amz-Signature=fixture`, metadata: { storage_backend: "s3" } });
        uploads++; assert.equal(prepared, true); assert.equal(init?.method, "PUT"); assert.equal(init?.redirect, "error"); const headers = new Headers(init?.headers); assert.equal(headers.get("x-api-key"), null); assert.equal(headers.get("authorization"), null); assert.equal(headers.get("cookie"), null); assert.equal(await new Response(init?.body).text(), "fixture-video"); return new Response(null, { status: 200 });
      });
      const work = client.stageInstagramVideo(file, "video.mp4", (id) => { assert.equal(id, "file_fixture"); prepared = true; });
      if (allowed) assert.equal((await work).id, "file_fixture"); else await assert.rejects(work, /destination could not be verified/);
      assert.equal(prepared, true, "accepted allocation is journaled even if its upload origin is rejected"); assert.equal(uploads, allowed ? 1 : 0);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
