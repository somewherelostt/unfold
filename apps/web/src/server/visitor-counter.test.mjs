import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { sourceLoader } from "./test-loader.mjs";

const { visitorHandlers } = sourceLoader({ "@unfold/cloud": {} })("./visitor-counter.ts");
const origin = "https://unfold.maazx.dev";
const id = "a3456789-1234-4abc-8def-0123456789ab";
const env = { NODE_ENV: "production", VERCEL_ENV: "production", UNFOLD_ENCRYPTION_KEY: "12".repeat(32) };
const json = (response) => response.json();

test("the public GET waits for a real request before reading the database aggregate", async () => {
  let release, reads = 0;
  const connected = new Promise((resolve) => { release = resolve; });
  const route = sourceLoader({
    "next/server": { connection: () => connected },
    "@/server/visitor-counter": { visitorHandlers: () => ({ GET: async () => { reads++; return Response.json({ count: 0 }); } }) },
  })("../app/api/visitors/route.ts");
  const response = route.GET();
  await Promise.resolve();
  assert.equal(reads, 0);
  release();
  assert.deepEqual(await (await response).json(), { count: 0 });
  assert.equal(reads, 1);
});

function request(options = {}) {
  return new Request(options.url ?? `${origin}/api/visitors`, {
    method: "POST",
    headers: { host: "unfold.maazx.dev", origin, "sec-fetch-site": "same-origin", "content-type": "application/json", ...options.headers },
    body: options.body ?? JSON.stringify({ visitorId: id }),
  });
}
function fixture(overrides = {}) {
  const calls = [];
  const db = {
    get: async () => ({ count: "0" }),
    run: async (...args) => { calls.push(args); return { changes: 1 }; },
    transaction: async (_key, work) => work(),
    ...overrides,
  };
  return { calls, handlers: visitorHandlers({ db: () => db, env }) };
}

test("GET exposes only the real aggregate, including zero, without writing or setting cookies", async () => {
  const { calls, handlers } = fixture({ get: async () => ({ count: "0", visitor_hash: "must-never-leak" }) });
  const response = await handlers.GET();
  assert.deepEqual(await json(response), { count: 0 });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(calls, []);
});

test("POST stores only a domain-separated server HMAC and normalizes UUID case", async () => {
  const { calls, handlers } = fixture({ get: async () => ({ count: "1" }) });
  const response = await handlers.POST(request({ headers: { "user-agent": "private-agent", "x-forwarded-for": "192.0.2.1" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { count: 1 });
  const hash = createHmac("sha256", Buffer.from(env.UNFOLD_ENCRYPTION_KEY, "hex")).update("unfold:landing-visitors:v1\0").update(id).digest("hex");
  assert.equal(calls[0][1], hash);
  assert.equal(calls[0].length, 2);
  assert.ok(!JSON.stringify(calls).includes(id));
  assert.ok(!JSON.stringify(calls).includes("private-agent"));
  assert.ok(!JSON.stringify(calls).includes("192.0.2.1"));
  await handlers.POST(request({ body: JSON.stringify({ visitorId: id.toUpperCase() }) }));
  assert.equal(calls[1][1], hash);
});

test("local, preview, cross-origin, missing-Origin and forwarded-host requests never increment", async () => {
  const { calls, handlers } = fixture();
  for (const options of [
    { url: "http://localhost:3000/api/visitors" },
    { url: "https://preview.vercel.app/api/visitors" },
    { headers: { host: "preview.vercel.app", "x-forwarded-host": "unfold.maazx.dev" } },
    { headers: { origin: "https://evil.example" } },
    { headers: { origin: "null" } },
    { headers: { "sec-fetch-site": "same-site" } },
    { headers: { "sec-fetch-site": "cross-site" } },
  ]) assert.equal((await handlers.POST(request(options))).status, 403);
  const missingOrigin = request();
  missingOrigin.headers.delete("origin");
  assert.equal((await handlers.POST(missingOrigin)).status, 403);
  for (const changedEnv of [{ ...env, VERCEL_ENV: "preview" }, { ...env, NODE_ENV: "development" }]) {
    const guarded = visitorHandlers({ db: () => { throw new Error("Must not connect"); }, env: changedEnv });
    assert.equal((await guarded.POST(request())).status, 403);
  }
  assert.deepEqual(calls, []);
});

test("POST rejects malformed, extra-field, invalid UUID and oversized bodies before writing", async () => {
  const { calls, handlers } = fixture();
  for (const body of ["{", "null", "[]", "{}", JSON.stringify({ visitorId: "not-random" }), JSON.stringify({ visitorId: id, ip: "192.0.2.1" }), JSON.stringify({ visitorId: id.replace("4abc", "1abc") })]) {
    assert.equal((await handlers.POST(request({ body }))).status, 400, body);
  }
  assert.equal((await handlers.POST(request({ headers: { "content-type": "text/plain" } }))).status, 415);
  assert.equal((await handlers.POST(request({ body: "x".repeat(257) }))).status, 413);
  assert.equal((await handlers.POST(request({ headers: { "content-length": "257" } }))).status, 413);
  assert.deepEqual(calls, []);
});

test("service and configuration failures return unavailable, never a fabricated zero or secrets", async () => {
  const secret = "postgresql://sensitive:secret@private.invalid/database";
  const { handlers } = fixture({ get: async () => { throw new Error(secret); } });
  for (const response of [await handlers.GET(), await handlers.POST(request())]) {
    assert.equal(response.status, 503);
    assert.deepEqual(await json(response), { error: "Visitor count unavailable." });
  }
  const missingKey = visitorHandlers({ db: () => { throw new Error("Must not connect"); }, env: { ...env, UNFOLD_ENCRYPTION_KEY: "" } });
  assert.equal((await missingKey.POST(request())).status, 503);
  const invalid = fixture({ get: async () => ({ count: "9007199254740992" }) });
  assert.equal((await invalid.handlers.GET()).status, 503);
});
