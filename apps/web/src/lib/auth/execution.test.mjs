import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "../../server/test-loader.mjs";

function resolver({ storedKey = async (userId) => `fixture-${userId}`, devMode = false } = {}) {
  const used = [];
  const load = sourceLoader({
    "@unfold/agent": { agentConfigFromEnv: () => ({ url: "http://demo.invalid", token: "demo-token", agentId: "unfold" }) },
    "./api-keys": { getStoredUserApiKey: storedKey },
    "./env": { isDevNoAuth: () => devMode },
    "./providers": { CEREBRAS_MODEL: "moonshotai-kimi-k3.1-pro-trial" },
    "./isolated-gateway": { startIsolatedGateway: async (key) => { used.push(key); return { config: { url: `http://fixture-${used.length}.invalid`, token: `token-${used.length}`, agentId: "unfold" }, dispose: async () => {} }; } },
  }, { CEREBRAS_API_KEY: "shared-fixture-key" });
  return { ...load("../lib/auth/execution.ts"), used };
}

test("account execution resolves each saved key independently under concurrent requests", async () => {
  const { createExecution, used } = resolver();
  const [a, b] = await Promise.all([createExecution({ id: "a" }), createExecution({ id: "b" })]);
  assert.deepEqual(used.sort(), ["fixture-a", "fixture-b"]);
  assert.equal(a.mode, "user-key");
  assert.equal(b.mode, "user-key");
  assert.notEqual(a.config.url, b.config.url);
  assert.notEqual(a.config.token, b.config.token);
});

test("a missing or unreadable account key cannot fall back to a server credential", async () => {
  for (const [storedKey, status] of [[async () => null, 428], [async () => { throw new Error("fixture decrypt failure"); }, 503]]) {
    const { createExecution, used } = resolver({ storedKey });
    await assert.rejects(createExecution({ id: "a" }), (error) => error.status === status);
    assert.equal(used.length, 0);
  }
});

test("only an explicit local demo identity uses the shared gateway", async () => {
  const { createExecution, used } = resolver({ devMode: true });
  const demo = await createExecution({ id: "demo", dev: true });
  const account = await createExecution({ id: "a" });
  assert.equal(demo.mode, "local-demo");
  assert.equal(account.mode, "user-key");
  assert.deepEqual(used, ["fixture-a"]);
});

test("the key helper itself never substitutes a shared key for a missing user key", async () => {
  const load = sourceLoader({
    "@/lib/crypto": {}, "./env": { isDevNoAuth: () => false, isAuthConfigured: () => true },
    "./server": { createClient: async () => null, createAdminClient: () => null },
  }, { CEREBRAS_API_KEY: "shared-fixture-key" });
  const { getUserApiKey } = load("../lib/auth/api-keys.ts");
  assert.equal(await getUserApiKey("a", "cerebras"), null);
  assert.equal(await getUserApiKey(null, "cerebras"), null);
});
