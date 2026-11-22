import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PublishingStore } from "../src/store.ts";
import { resolveSchedule } from "../src/time.ts";
import { parseDestinations, validateDestination } from "../src/validation.ts";
import { accountView, postView, type Account, type CompletedExport, type DestinationInput } from "../src/types.ts";
import { ComposioClient, ProviderFault, TOOL_SPECS } from "../src/composio.ts";
import { loadPublishingConfig, TOOLKIT_VERSIONS } from "../src/config.ts";
import { Publisher } from "../src/dispatch.ts";

const owner = { id: "owner-one" }, other = { id: "owner-two" };
const media: CompletedExport = { ref: { projectId: "project-one", fileKey: "export-one.mp4" }, mediaContentSha256: "a".repeat(64), properties: { bytes: 1000, duration: 12, width: 1080, height: 1920, fps: 30, mime: "video/mp4", videoCodec: "h264", audioCodec: "aac" }, previewUrl: "/media/project-one/exports/export-one.mp4" };
const account = (id = "account-one", platform: Account["platform"] = "instagram"): Account => ({ id, ownerId: owner.id, platform, providerAccountId: `ca_${id}`, providerUserId: "user-one", authConfigId: "ac_one", status: "connected", identity: { id: "123", handle: "fixture", name: "Fixture", accountType: "BUSINESS" }, requestedScopes: [], verifiedAt: 1, createdAt: 1 });
const destination = (accountId = "account-one"): DestinationInput => ({ accountId, platform: "instagram", text: "A fixture post", instagram: { shareToFeed: true, thumbnailMs: 0 } });
class StagingFixtureClient extends ComposioClient {
  override async stageInstagramVideo(_path: string, filename: string, onPrepared: (id: string) => void) { onPrepared("file_fixture"); return { id: "file_fixture", file: { name: filename, mimetype: "video/mp4" as const, s3key: "private-fixture-key" } }; }
}
async function fixture(fn: (s: PublishingStore, advance: (ms: number) => void, file: string) => unknown) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "unfold-publishing-")), file = path.join(dir, "publishing.sqlite"); let now = 1_800_000_000_000;
  const store = new PublishingStore(file, () => now, 1000); store.putAccount(account());
  try { await fn(store, (ms) => { now += ms; }, file); } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
}
test("explicit time zones preserve non-hour offsets and reject DST gaps/overlaps", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(resolveSchedule({ mode: "scheduled", localDateTime: "2026-03-10T09:00", timeZone: "Asia/Kolkata" }, now).at, Date.parse("2026-03-10T03:30:00Z"));
  assert.throws(() => resolveSchedule({ mode: "scheduled", localDateTime: "2026-03-08T02:30", timeZone: "America/New_York" }, now), /skipped/);
  assert.throws(() => resolveSchedule({ mode: "scheduled", localDateTime: "2026-11-01T01:30", timeZone: "America/New_York" }, now), /twice/);
  const a = resolveSchedule({ mode: "scheduled", localDateTime: "2026-11-01T01:30", timeZone: "America/New_York", disambiguation: "earlier" }, now);
  const b = resolveSchedule({ mode: "scheduled", localDateTime: "2026-11-01T01:30", timeZone: "America/New_York", disambiguation: "later" }, now);
  assert.equal(b.at - a.at, 3_600_000);
  assert.throws(() => resolveSchedule({ mode: "scheduled", localDateTime: "2026-02-30T01:30", timeZone: "UTC" }, now));
});
test("owner scoping, stable submission idempotency, safe view and revision conflicts", () => fixture((s) => {
  const at = resolveSchedule({ mode: "now" }, 1_800_000_000_000);
  const p = s.create(owner, media, [destination()], at, "submission-one");
  assert.equal(s.create(owner, media, [destination()], { ...at, at: at.at + 5000, localDateTime: "later" }, "submission-one").id, p.id);
  assert.throws(() => s.create(owner, media, [{ ...destination(), text: "changed" }], at, "submission-one"), /changed/);
  assert.throws(() => s.get(other, p.id), /Not found/); assert.equal(s.list(other).length, 0); assert.throws(() => s.account(other, "account-one"), /Not found/);
  assert(!JSON.stringify(accountView(account())).includes("ca_account")); assert(!JSON.stringify(postView(p)).includes("owner-one"));
  const revised = s.revise(owner, p.id, 1, [{ ...destination(), text: "Updated" }], at);
  assert.equal(revised.revision, 2); assert.throws(() => s.cancel(owner, p.id, 1), /changed elsewhere/);
  assert.equal(s.cancel(owner, p.id, 2).destinations[0].state, "cancelled"); assert.equal(s.claim(), null);
}));
test("SQLite survives reopening; future dispatch and two independent claimers do not duplicate", () => fixture((s, advance, file) => {
  const at = resolveSchedule({ mode: "now" }, 1_800_000_060_000);
  const p = s.create(owner, media, [destination()], { ...at, mode: "scheduled" }, "submission-two");
  const reopened = new PublishingStore(file, () => 1_800_000_000_000, 1000);
  assert.equal(reopened.get(owner, p.id).id, p.id); assert.equal(reopened.claim(), null); reopened.close();
  advance(60_001); const first = s.claim()!; assert.equal(first.destination.postId, p.id);
  const second = new PublishingStore(file, () => 1_800_000_060_001, 1000); assert.equal(second.claim(), null); second.close();
  assert.throws(() => s.revise(owner, p.id, 1, [destination()], at), /started publishing/);
}));
test("expired mutation ownership becomes reconciliation; stale fence cannot finish or redispatch", () => fixture((s, advance) => {
  const p = s.create(owner, media, [destination()], resolveSchedule({ mode: "now" }, 1_800_000_000_000), "submission-three");
  const first = s.claim()!, op = s.reserveOperation(first.destination.id, first.token, "instagram_publish");
  s.checkpointOperation(first.destination.id, first.token, op, { containerId: "456" }); advance(1001);
  const next = s.claim()!; assert.equal(next.destination.state, "reconciling");
  assert.throws(() => s.completeOperation(first.destination.id, first.token, op, { postId: "789" }), /ownership changed/);
  assert.throws(() => s.reserveOperation(next.destination.id, next.token, "instagram_publish"), /verification/);
  s.release(next.destination.id, next.token, { state: "unknown" });
  assert.throws(() => s.retry(owner, p.id, next.destination.id), /cannot safely/); assert.equal(s.claim(), null);
}));
test("delivery secrets are owner-bound, expire, and are revoked on disconnect", () => fixture((s, advance) => {
  const p = s.create(owner, media, [destination()], resolveSchedule({ mode: "now" }, 1_800_000_000_000), "submission-four"), c = s.claim()!;
  const grant = s.issueDelivery(c.destination.id, c.token, { kind: "video", fileKey: media.ref.fileKey }, 1000);
  assert.equal(s.delivery(grant.capability).ownerId, owner.id); assert.throws(() => s.issueDelivery(c.destination.id, c.token, { kind: "video", fileKey: "other.mp4" }));
  assert.equal(s.delivery(grant.capability).postId, p.id); advance(1001); assert.throws(() => s.delivery(grant.capability));
  const c2 = s.claim()!, g2 = s.issueDelivery(c2.destination.id, c2.token, { kind: "video", fileKey: media.ref.fileKey });
  s.disconnect(owner, "account-one"); assert.throws(() => s.delivery(g2.capability));
}));
test("deletion admission fence commits revocation even with an unresolved external operation", () => fixture((s) => {
  s.create(owner, media, [destination()], resolveSchedule({ mode: "now" }, 1_800_000_000_000), "submission-five"); const c = s.claim()!;
  const g = s.issueDelivery(c.destination.id, c.token, { kind: "video", fileKey: media.ref.fileKey }); s.reserveOperation(c.destination.id, c.token, "instagram_publish");
  assert.equal(s.beginDeletion(owner, media.ref.projectId).ready, false); assert.throws(() => s.delivery(g.capability));
  assert.throws(() => s.create(owner, media, [destination()], resolveSchedule({ mode: "now" }), "submission-six"), /being removed/);
  assert.equal(s.claim(), null);
}));
test("partial success retry changes only the explicitly failed destination", () => fixture((s) => {
  s.putAccount(account("account-two", "pinterest"));
  const pin: DestinationInput = { accountId: "account-two", platform: "pinterest", text: "Pin", pinterest: { boardId: "123", title: "Pin", altText: "A fixture video", coverFrameMs: 0 } };
  const p = s.create(owner, media, [destination(), pin], resolveSchedule({ mode: "now" }, 1_800_000_000_000), "submission-seven");
  const a = s.claim()!, b = s.claim()!; s.release(a.destination.id, a.token, { state: "published", checkpoint: { postId: "999" } }); s.release(b.destination.id, b.token, { state: "failed", error: { code: "RATE_LIMITED", message: "Try later", retryable: true } });
  const retried = s.retry(owner, p.id, b.destination.id); assert.equal(retried.destinations.find((d) => d.id === a.destination.id)!.state, "published"); assert.equal(s.claim()!.destination.id, b.destination.id);
}));
test("connection state is single use, expires, and cannot cross owners", () => fixture((s, advance) => {
  const { state } = s.beginConnection(owner, "instagram", "account-one"); assert.throws(() => s.connection(other, state));
  s.completeConnection(owner, state, account()); assert.throws(() => s.connection(owner, state));
  const next = s.beginConnection(owner, "instagram", "account-one"); advance(600_001); assert.throws(() => s.connection(owner, next.state));
}));
test("platform validation rejects irrelevant inputs and counts Bluesky graphemes", () => {
  assert.throws(() => parseDestinations([{ ...destination(), ownerId: other.id }]));
  assert.throws(() => parseDestinations([{ ...destination(), pinterest: {} }]));
  const b: DestinationInput = { accountId: "bluesky", platform: "bluesky", text: "👨‍👩‍👧‍👦".repeat(301), bluesky: { altText: "", languages: [] } };
  assert(validateDestination(b, media).some((i) => i.field === "text" && i.severity === "error"));
  assert(validateDestination(destination(), { ...media, properties: { ...media.properties, bytes: 300_000_001 } }).some((i) => i.field === "video" && i.severity === "error"));
});
test("REST adapter pins verified tool schemas and never leaks raw provider errors", async () => {
  const config = loadPublishingConfig("/tmp", { COMPOSIO_API_KEY: "fixture-key", UNFOLD_PUBLISHING_INSTAGRAM_AUTH_CONFIG: "ac_one" });
  let sent: RequestInit | undefined;
  const client = new ComposioClient(config, async (url, init) => {
    sent = init; const slug = new URL(String(url)).pathname.split("/").pop()!;
    if (String(url).includes("/tools/execute/")) return Response.json({ successful: false, error: "secret-token" });
    assert.equal(new URL(String(url)).searchParams.get("version"), TOOLKIT_VERSIONS.instagram);
    return Response.json({ slug, toolkit: { slug: "instagram" }, version: TOOLKIT_VERSIONS.instagram, input_parameters: Object.fromEntries((TOOL_SPECS.instagram[slug as keyof typeof TOOL_SPECS.instagram] as readonly string[]).map((key) => [key, {}])) });
  });
  assert.equal((await client.capability("instagram")).available, true); assert.equal((await client.capability("bluesky")).available, false);
  await assert.rejects(client.execute(account(), "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", { creation_id: "456", ig_user_id: "123" }, true), (error: unknown) => error instanceof ProviderFault && error.outcome === "ambiguous" && !error.message.includes("secret-token"));
  const body = JSON.parse(String(sent!.body)); assert.equal(body.connected_account_id, account().providerAccountId); assert.equal(body.version, TOOLKIT_VERSIONS.instagram);
});
test("a timed-out Instagram publish is verified and never sent a second time", () => fixture(async (s, advance) => {
  s.create(owner, media, [destination()], resolveSchedule({ mode: "now" }, 1_800_000_000_000), "submission-eight");
  const calls: string[] = [];
  class FixtureClient extends StagingFixtureClient {
    override async verifyAccount(a: Account) { return a; }
    override async execute(_a: Account, slug: string, args: Record<string, unknown>) { calls.push(slug); if (slug === "INSTAGRAM_POST_IG_USER_MEDIA") { assert.equal(s.list(owner)[0].destinations[0].checkpoint.stagedFileId, "file_fixture"); assert.equal((args.video_file as { s3key: string }).s3key, "private-fixture-key"); assert.equal("video_url" in args, false); return { id: "456" }; } if (slug === "INSTAGRAM_GET_MULTIPLE_NODES") return { "456": { id: "456", status_code: "FINISHED" } }; throw new ProviderFault("TIMEOUT", "Fixture timeout", "ambiguous"); }
  }
  const publisher = new Publisher(s, new FixtureClient(loadPublishingConfig("/tmp", {})), { open: async () => ({ absolutePath: "/fixture.mp4", release: async () => {} }), videoUrl: async () => "https://fixture.invalid/video", coverUrl: async () => "https://fixture.invalid/cover" });
  await publisher.dispatch(s.claim()!); advance(60_001); await publisher.dispatch(s.claim()!); advance(60_001); await publisher.dispatch(s.claim()!);
  assert.equal(calls.filter((x) => x === "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH").length, 1); assert.equal(s.list(owner)[0].destinations[0].state, "unknown"); assert.equal(JSON.stringify(s.list(owner)).includes("private-fixture-key"), false); assert.equal(JSON.stringify(postView(s.list(owner)[0])).includes("file_fixture"), false);
}));
test("Pinterest fixture persists upload ID before bytes and verifies the final Pin independently", () => fixture(async (s, advance) => {
  s.putAccount(account("pin-account", "pinterest"));
  const pin: DestinationInput = { accountId: "pin-account", platform: "pinterest", text: "Fixture Pin", pinterest: { boardId: "321", title: "A Pin", altText: "The fixture video", coverFrameMs: 0 } };
  const post = s.create(owner, media, [pin], resolveSchedule({ mode: "now" }, 1_800_000_000_000), "pinterest-fixture"); const calls: string[] = [];
  class FixtureClient extends StagingFixtureClient {
    override async verifyAccount(a: Account) { return a; }
    override async execute(_a: Account, slug: string, args: Record<string, unknown>) { calls.push(slug); if (slug === "PINTEREST_CREATE_PIN") { assert.equal((args.media_source as Record<string, unknown>).cover_image_key_frame_time, 0); assert.equal("cover_image_url" in (args.media_source as Record<string, unknown>), false); } if (slug === "PINTEREST_GET_BOARD") return { id: "321" }; if (slug === "PINTEREST_REGISTER_MEDIA") return { media_id: "456", upload_url: "https://fixture.s3.amazonaws.com/", upload_parameters: { key: "fixture" } }; if (slug === "PINTEREST_GET_MEDIA") return { media_id: "456", status: "succeeded" }; if (slug === "PINTEREST_CREATE_PIN" || slug === "PINTEREST_GET_PIN") return { id: "789" }; throw Error("Unexpected fixture action"); }
  }
  let uploads = 0;
  const publisher = new Publisher(s, new FixtureClient(loadPublishingConfig("/tmp", {})), { open: async () => ({ absolutePath: "/fixture.mp4", release: async () => {} }), videoUrl: async () => "https://fixture.invalid/video", coverUrl: async () => "https://fixture.invalid/cover" }, async () => { uploads++; const d = s.get(owner, post.id).destinations[0]; assert.equal(d.checkpoint.uploadId, "456"); assert(d.activeOperation); });
  await publisher.dispatch(s.claim()!); advance(60_001); await publisher.dispatch(s.claim()!); await publisher.dispatch(s.claim()!);
  const result = s.get(owner, post.id).destinations[0]; assert.equal(uploads, 1); assert.equal(calls.filter((s) => s === "PINTEREST_CREATE_PIN").length, 1); assert.equal(result.state, "published"); assert.equal(result.checkpoint.permalink, "https://www.pinterest.com/pin/789/");
}));
test("an explicit reconnect must preserve the exact verified upstream identity", () => fixture((s) => {
  const attempt = s.beginConnection(owner, "instagram", "replacement", "account-one"), replacement = { ...account("replacement"), providerAccountId: "ca_replacement" };
  s.putAccount({ ...replacement, status: "connecting", identity: null });
  assert.throws(() => s.completeConnection(owner, attempt.state, { ...replacement, identity: { id: "different", handle: "different", name: "Different" } }), /same social account/);
  const result = s.completeConnection(owner, attempt.state, replacement); assert.equal(result.id, "account-one"); assert.equal(s.account(owner, "account-one").providerAccountId, "ca_replacement"); assert.throws(() => s.account(owner, "replacement"));
}));
test("disconnect wins a race against a pending identity refresh and new external operation", () => fixture((s) => {
  const post = s.create(owner, media, [destination()], resolveSchedule({ mode: "now" }, 1_800_000_000_000), "disconnect-fixture"), c = s.claim()!;
  s.disconnect(owner, "account-one"); assert.throws(() => s.putAccount(account()), /disconnected/); assert.throws(() => s.reserveOperation(c.destination.id, c.token, "instagram_publish"), /disconnected/); assert.equal(s.get(owner, post.id).destinations[0].activeOperation, null);
}));
test("cancelling one undispatched destination leaves another in-flight destination untouched", () => fixture((s) => {
  s.putAccount(account("account-two", "pinterest")); const pin: DestinationInput = { accountId: "account-two", platform: "pinterest", text: "Pin", pinterest: { boardId: "123", title: "Pin", altText: "Fixture", coverFrameMs: 0 } };
  const p = s.create(owner, media, [destination(), pin], resolveSchedule({ mode: "now" }, 1_800_000_000_000), "cancel-destination"); const c = s.claim()!;
  const pending = p.destinations.find((d) => d.id !== c.destination.id)!; const updated = s.cancelDestination(owner, p.id, pending.id, p.revision);
  assert.equal(updated.destinations.find((d) => d.id === pending.id)!.state, "cancelled"); assert.equal(updated.destinations.find((d) => d.id === c.destination.id)!.state, "publishing");
}));
test("managed OAuth preparation limits scopes/tools and coalesces concurrent account connections", async () => {
  const config = loadPublishingConfig("/tmp", { COMPOSIO_API_KEY: "fixture-key" }); let creates = 0;
  const client = new ComposioClient(config, async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/toolkits/instagram")) return Response.json({ slug: "instagram", composio_managed_auth: [{ mode: "OAUTH2", is_default: true, managed_app_id: "ma_fixture", scopes: { available: ["instagram_business_basic", "instagram_business_content_publish"] } }] });
    if (init?.method === "GET" && u.pathname.endsWith("/auth_configs")) return Response.json({ items: [] });
    assert.equal(init?.method, "POST"); creates++; const body = JSON.parse(String(init?.body));
    assert.equal(body.toolkit.slug, "instagram"); assert.equal(body.auth_config.credentials.scopes, "instagram_business_basic,instagram_business_content_publish"); assert.deepEqual(body.auth_config.restrict_to_following_tools, Object.keys(TOOL_SPECS.instagram));
    return Response.json({ toolkit: { slug: "instagram" }, auth_config: { id: "ac_fixture" } }, { status: 201 });
  });
  const result = await Promise.all([client.prepareAuthConfig("instagram"), client.prepareAuthConfig("instagram")]); assert.deepEqual(result, ["ac_fixture", "ac_fixture"]); assert.equal(creates, 1);
});
test("missing managed publishing scopes stay unavailable; Bluesky catalog probes are metadata-only", async () => {
  let mutations = 0;
  const client = new ComposioClient(loadPublishingConfig("/tmp", { COMPOSIO_API_KEY: "fixture" }), async (url, init) => {
    if (init?.method !== "GET") mutations++;
    if (String(url).includes("bluesky")) return Response.json({}, { status: 404 });
    return Response.json({ slug: "instagram", composio_managed_auth: [{ mode: "OAUTH2", is_default: true, scopes: { available: ["instagram_business_basic"] } }] });
  });
  await assert.rejects(client.prepareAuthConfig("instagram"), /access required/); assert.equal(mutations, 0); assert.equal((await client.inspectBlueskyCatalog()).toolkitExists, false);
});
test("polling or preview verification cannot activate an OAuth mapping before the owner-bound state callback", () => fixture((s) => {
  const pending = { ...account("new-connection"), identity: null, verifiedAt: null, status: "connecting" as const }; s.putAccount(pending);
  assert.throws(() => s.putAccount(account("new-connection")), /connection window/);
  const { state } = s.beginConnection(owner, "instagram", pending.id); s.completeConnection(owner, state, account("new-connection"));
  assert.equal(s.account(owner, pending.id).status, "connected"); assert.doesNotThrow(() => s.putAccount(account("new-connection")));
}));
test("production worker refuses a development-owned post before any external account request", () => fixture(async (s) => {
  const p = s.create({ ...owner, dev: true }, media, [destination()], resolveSchedule({ mode: "now" }, 1_800_000_000_000), "development-post"); let calls = 0;
  class FixtureClient extends StagingFixtureClient { override async verifyAccount(a: Account) { calls++; return a; } }
  const publisher = new Publisher(s, new FixtureClient(loadPublishingConfig("/tmp", {})), { open: async () => { throw Error("Should not open"); }, videoUrl: async () => "", coverUrl: async () => "" });
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  try { await publisher.dispatch(s.claim()!); assert.equal(calls, 0); assert.equal(s.get(owner, p.id).destinations[0].error?.code, "SIGN_IN_REQUIRED"); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
}));
test("older future schedules remain visible ahead of newer published history", () => fixture((s) => {
  const at = resolveSchedule({ mode: "now" }, 1_800_000_000_000), future = s.create(owner, media, [destination()], { ...at, mode: "scheduled", at: at.at + 86_400_000 }, "future-schedule");
  for (let i = 0; i < 201; i++) { s.create(owner, media, [destination()], at, `history-${i}`); const c = s.claim()!; s.release(c.destination.id, c.token, { state: "published", checkpoint: { postId: String(10000 + i) } }); }
  assert.equal(s.list(owner)[0].id, future.id); assert.equal(s.accountDestinations(owner, "account-one").length, 202); assert.throws(() => s.accountDestinations(other, "account-one"));
}));
test("a manual Check result never initiates a new public publication", () => fixture(async (s) => {
  const p = s.create(owner, media, [destination()], resolveSchedule({ mode: "now" }, 1_800_000_000_000), "manual-check"); const c = s.claim()!;
  s.release(c.destination.id, c.token, { state: "unknown", checkpoint: { containerId: "456" }, error: { code: "PROCESSING_DELAYED", message: "Delayed", retryable: false } }); s.reconcile(owner, p.id, c.destination.id);
  let publishes = 0;
  class FixtureClient extends StagingFixtureClient {
    override async verifyAccount(a: Account) { return a; }
    override async execute(_a: Account, slug: string) { if (slug === "INSTAGRAM_GET_MULTIPLE_NODES") return { "456": { id: "456", status_code: "FINISHED" } }; publishes++; return { id: "789" }; }
  }
  const publisher = new Publisher(s, new FixtureClient(loadPublishingConfig("/tmp", {})), { open: async () => ({ absolutePath: "/fixture", release: async () => {} }), videoUrl: async () => "", coverUrl: async () => "" });
  await publisher.dispatch(s.claim()!); assert.equal(publishes, 0); assert.equal(s.get(owner, p.id).destinations[0].error?.code, "READY_TO_RETRY");
}));
