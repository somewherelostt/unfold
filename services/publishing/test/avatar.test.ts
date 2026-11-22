import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PublishingStore } from "../src/store.ts";
import { ComposioClient } from "../src/composio.ts";
import { loadPublishingConfig } from "../src/config.ts";
import { serveAccountAvatar } from "../../../apps/web/src/server/publishing/avatar.ts";
import type { Account } from "../src/types.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ5kAAAAASUVORK5CYII=", "base64");
async function fixture(work: (store: PublishingStore, account: Account, client: ComposioClient, setProfile: (profile: Record<string, unknown>) => void) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-avatar-")), store = new PublishingStore(path.join(root, "publishing.sqlite"));
  const account: Account = { id: randomUUID(), ownerId: randomUUID(), platform: "instagram", providerAccountId: "ca_fixture", providerUserId: "fixture", authConfigId: "ac_fixture", identity: { id: "123", handle: "fixture", name: "Fixture" }, status: "connected", requestedScopes: [], verifiedAt: 1, createdAt: 1 };
  let profile = { id: "123", profile_picture_url: "https://scontent.cdninstagram.com/avatar.jpg?ephemeral=fixture" } as Record<string, unknown>;
  class Client extends ComposioClient { override async execute(_account: Account, slug: string, args: Record<string, unknown>, mutation: boolean) { assert.equal(slug, "INSTAGRAM_GET_USER_INFO"); assert.equal(args.ig_user_id, "123"); assert.equal(args.fields, "id,profile_picture_url"); assert.equal(mutation, false); return profile; } }
  store.putAccount(account);
  try { await work(store, account, new Client(loadPublishingConfig(root, {})), (value) => { profile = value; }); } finally { store.close(); await rm(root, { recursive: true, force: true }); }
}
test("profile images authorize every cache hit and never forward credentials or signed URLs", () => fixture(async (store, account, client) => {
  let calls = 0; const owner = { id: account.ownerId };
  const fetcher: typeof fetch = async (url, init) => { calls++; assert.equal(new URL(String(url)).hostname, "scontent.cdninstagram.com"); const headers = new Headers(init?.headers); assert.equal(headers.get("authorization"), null); assert.equal(headers.get("x-api-key"), null); assert.equal(headers.get("cookie"), null); assert.equal(init?.redirect, "error"); return new Response(png, { headers: { "Content-Type": "image/png" } }); };
  const first = await serveAccountAvatar(owner, account.id, store, client, { fetcher }); assert.equal(first.status, 200); assert.equal(first.headers.get("cache-control"), "private, no-store"); assert.equal(first.headers.get("content-type"), "image/png"); assert.equal(first.headers.get("x-content-type-options"), "nosniff"); first.headers.forEach((value, name) => { assert.equal(value.includes("ephemeral"), false); assert.equal(name.includes("ephemeral"), false); }); assert.equal((await first.arrayBuffer()).byteLength, png.length);
  assert.equal((await serveAccountAvatar(owner, account.id, store, client, { fetcher })).status, 200); assert.equal(calls, 1);
  await assert.rejects(serveAccountAvatar({ id: "other" }, account.id, store, client, { fetcher }));
  store.disconnect(owner, account.id); assert.equal((await serveAccountAvatar(owner, account.id, store, client, { fetcher })).status, 404); assert.equal(calls, 1);
}));
test("profile images reject wrong identities, untrusted hosts, active content and oversized streams", () => fixture(async (store, account, client, setProfile) => {
  const owner = { id: account.ownerId }; let calls = 0, cancelled = false;
  const unused: typeof fetch = async () => { calls++; throw Error("Must not fetch"); };
  setProfile({ id: "other", profile_picture_url: "https://scontent.cdninstagram.com/avatar.jpg" }); assert.equal((await serveAccountAvatar(owner, account.id, store, client, { fetcher: unused })).status, 404);
  setProfile({ id: "123", profile_picture_url: "https://cdninstagram.com.attacker.invalid/avatar.jpg" }); assert.equal((await serveAccountAvatar(owner, account.id, store, client, { fetcher: unused })).status, 404); assert.equal(calls, 0);
  setProfile({ id: "123", profile_picture_url: "https://scontent.cdninstagram.com/avatar.jpg" });
  assert.equal((await serveAccountAvatar(owner, account.id, store, client, { fetcher: async () => new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }) })).status, 404);
  assert.equal((await serveAccountAvatar(owner, account.id, store, client, { fetcher: async () => new Response("<html/>", { headers: { "Content-Type": "image/png" } }) })).status, 404);
  const oversized: typeof fetch = async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(300_000)); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "image/png" } });
  assert.equal((await serveAccountAvatar(owner, account.id, store, client, { fetcher: oversized })).status, 404); assert.equal(cancelled, true);
}));
test("profile image timeouts return a safe fallback response", () => fixture(async (store, account, client) => {
  const fetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(Error("Fixture did not abort")), 500); init!.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(Error("Fixture abort")); }, { once: true }); });
  assert.equal((await serveAccountAvatar({ id: account.ownerId }, account.id, store, client, { fetcher, timeoutMs: 15 })).status, 404);
}));
test("disconnect wins while a profile image is being fetched", () => fixture(async (store, account, client) => {
  const owner = { id: account.ownerId };
  const result = await serveAccountAvatar(owner, account.id, store, client, { fetcher: async () => { store.disconnect(owner, account.id); return new Response(png, { headers: { "Content-Type": "image/png" } }); } });
  assert.equal(result.status, 404);
}));
