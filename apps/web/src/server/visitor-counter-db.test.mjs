import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { before, beforeEach, after } from "node:test";
import { sourceLoader } from "./test-loader.mjs";

const { CloudDatabase } = sourceLoader()("../../../../packages/cloud/src/database.ts");
const url = process.env.UNFOLD_TEST_DATABASE_URL ?? "postgresql://127.0.0.1:55432/unfold_test";
const target = new URL(url);
if (!["postgres:", "postgresql:"].includes(target.protocol) || !["127.0.0.1", "localhost"].includes(target.hostname) || !/^\/[a-zA-Z0-9_]+_test$/.test(target.pathname)) {
  throw new Error("Visitor fixtures require a disposable localhost/*_test database.");
}
const admin = new CloudDatabase(url);
target.searchParams.set("options", "-c role=unfold_runtime");
const a = new CloudDatabase(target.href), b = new CloudDatabase(target.href);
const { visitorHandlers } = sourceLoader({ "@unfold/cloud": {} })("./visitor-counter.ts");
const env = { NODE_ENV: "production", UNFOLD_ENCRYPTION_KEY: "34".repeat(32) };
const handlersA = visitorHandlers({ db: () => a, env }), handlersB = visitorHandlers({ db: () => b, env });
const firstId = "a3456789-1234-4abc-8def-0123456789ab";
function request(id = firstId) {
  return new Request("https://unfold.maazx.dev/api/visitors", { method: "POST", headers: {
    host: "unfold.maazx.dev", origin: "https://unfold.maazx.dev", "sec-fetch-site": "same-origin", "content-type": "application/json",
  }, body: JSON.stringify({ visitorId: id }) });
}

before(async () => {
  // Serialize this fixture suite on its own table. This guard runs before any DDL or fixtures.
  await admin.query("SELECT pg_advisory_lock(hashtext('unfold:visitor-counter-tests'))");
  // Local-only NOLOGIN fixture roles contain no credentials. Hosted roles are never created/changed.
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='unfold_runtime') THEN CREATE ROLE unfold_runtime NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  END $$`);
  await admin.query("GRANT USAGE ON SCHEMA unfold TO unfold_runtime");
  await admin.query("DROP TABLE IF EXISTS unfold.landing_visitors");
  await admin.query(readFileSync(new URL("../../../../db/migrations/20261122171553_landing_visitors.sql", import.meta.url), "utf8"));
});
beforeEach(async () => { await admin.query("TRUNCATE unfold.landing_visitors"); });
after(async () => {
  await a.close();
  await b.close();
  await admin.query("SELECT pg_advisory_unlock(hashtext('unfold:visitor-counter-tests'))");
  await admin.close();
});

test("independent restricted connections deduplicate concurrent visits and persist real totals", async () => {
  assert.equal((await a.get("SELECT current_user AS role")).role, "unfold_runtime");
  assert.deepEqual(await (await handlersA.GET()).json(), { count: 0 });
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? handlersA : handlersB).POST(request())));
  assert.ok(responses.every((response) => response.status === 200));
  for (const response of responses) assert.deepEqual(await response.json(), { count: 1 });
  for (const id of ["b3456789-1234-4abc-8def-0123456789ab", "c3456789-1234-4abc-8def-0123456789ab", firstId]) {
    assert.equal((await handlersB.POST(request(id))).status, 200);
  }
  assert.deepEqual(await (await handlersA.GET()).json(), { count: 3 });
  const stored = await admin.all("SELECT visitor_hash FROM unfold.landing_visitors");
  assert.equal(stored.length, 3);
  assert.ok(stored.every((row) => /^[0-9a-f]{64}$/.test(row.visitor_hash)));
  assert.ok(!JSON.stringify(stored).includes(firstId));
  const columns = await admin.all("SELECT column_name FROM information_schema.columns WHERE table_schema='unfold' AND table_name='landing_visitors'");
  assert.deepEqual(columns.map((row) => row.column_name), ["visitor_hash"]);
});

test("a failed aggregate query rolls back the deduplicated insert", async () => {
  const broken = visitorHandlers({ db: () => ({ run: a.run.bind(a), transaction: a.transaction.bind(a), get: async () => { throw new Error("Simulated database read failure"); } }), env });
  assert.equal((await broken.POST(request())).status, 503);
  assert.deepEqual(await (await handlersB.GET()).json(), { count: 0 });
  assert.deepEqual(await (await handlersA.POST(request())).json(), { count: 1 });
});

test("browser roles cannot read or insert hashes; runtime cannot modify or delete them", async () => {
  for (const role of ["anon", "authenticated"]) {
    const grants = await admin.get("SELECT has_table_privilege(?, 'unfold.landing_visitors', 'SELECT') AS read, has_table_privilege(?, 'unfold.landing_visitors', 'INSERT') AS write", role, role);
    assert.deepEqual(grants, { read: false, write: false });
    await assert.rejects(admin.transaction(`role-${role}`, async () => {
      await admin.query(`SET LOCAL ROLE ${role}`);
      await admin.query("SELECT * FROM unfold.landing_visitors");
    }), (error) => error.code === "42501");
    await assert.rejects(admin.transaction(`insert-${role}`, async () => {
      await admin.query(`SET LOCAL ROLE ${role}`);
      await admin.query("INSERT INTO unfold.landing_visitors VALUES ($1)", ["a".repeat(64)]);
    }), (error) => error.code === "42501");
  }
  await assert.rejects(a.query("UPDATE unfold.landing_visitors SET visitor_hash=$1", ["a".repeat(64)]), (error) => error.code === "42501");
  await assert.rejects(a.query("DELETE FROM unfold.landing_visitors"), (error) => error.code === "42501");
  await assert.rejects(a.query("INSERT INTO unfold.landing_visitors VALUES ($1)", [firstId]), (error) => error.code === "23514");
  const security = await admin.get("SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid='unfold.landing_visitors'::regclass");
  assert.deepEqual(security, { enabled: true, forced: true });
});
