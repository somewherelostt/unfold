import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "../../server/test-loader.mjs";

function loadView({ configured = true, encryption = true, user = { id: "account-a", email: "a@example.test" }, keys = [] } = {}) {
  const calls = [];
  const load = sourceLoader({
    "./env": { isAuthConfigured: () => configured },
    "@/lib/crypto": { isEncryptionConfigured: () => encryption },
    "./server": { getUser: async () => {
      calls.push("identity");
      if (user instanceof Error) throw user;
      return user;
    } },
    "./api-keys": { listUserKeys: async (id) => {
      calls.push(id);
      if (keys instanceof Error) throw keys;
      return keys;
    } },
  });
  return { getSettingsView: load("../lib/auth/settings-view.ts").getSettingsView, calls };
}

function assertNoActions(view) {
  assert.deepEqual(Object.values(view.cerebras.actions), [false, false, false, false]);
}

test("unconfigured account access exposes no bypass identity or temporary key", async () => {
  const { getSettingsView, calls } = loadView({
    configured: false,
    user: { id: "local-id", dev: true, email: "dev@unfold.local" },
    keys: [{ provider: "cerebras", last4: "TEMP", createdAt: "today" }],
  });
  const view = await getSettingsView();
  assert.equal(view.account.state, "unavailable");
  assert.equal(view.account.email, null);
  assert.equal(view.account.signInHref, null);
  assert.equal(view.cerebras.last4, null);
  assertNoActions(view);
  assert.deepEqual(calls, []);
});

test("a signed-out session offers sign-in without reading key storage", async () => {
  const { getSettingsView, calls } = loadView({ user: null });
  const view = await getSettingsView();
  assert.equal(view.account.state, "signed_out");
  assert.equal(view.account.email, null);
  assert.equal(view.account.signInHref, "/login?next=/settings");
  assert.equal(view.account.canSignOut, false);
  assert.equal(view.cerebras.state, "account_required");
  assertNoActions(view);
  assert.deepEqual(calls, ["identity"]);
});

test("a bypass identity with configured auth does not offer a looping sign-in link", async () => {
  const { getSettingsView, calls } = loadView({ user: { id: "local-id", dev: true, email: "dev@unfold.local" } });
  const view = await getSettingsView();
  assert.equal(view.account.state, "unavailable");
  assert.equal(view.account.email, null);
  assert.equal(view.account.signInHref, null);
  assert.equal(view.account.canSignOut, false);
  assert.equal(view.cerebras.state, "unavailable");
  assertNoActions(view);
  assert.deepEqual(calls, ["identity"]);
});

test("a verified account with a working key store can save its first key", async () => {
  const { getSettingsView, calls } = loadView();
  const view = await getSettingsView();
  assert.equal(view.account.state, "signed_in");
  assert.equal(view.account.email, "a@example.test");
  assert.equal(view.account.canSignOut, true);
  assert.equal(view.cerebras.state, "not_connected");
  assert.deepEqual(Object.values(view.cerebras.actions), [true, false, false, false]);
  assert.deepEqual(calls, ["identity", "account-a"]);
});

test("saved metadata exposes only Cerebras last-four and never claims a successful key check", async () => {
  const { getSettingsView } = loadView({ keys: [
    { provider: "gpu", last4: "OTHR", createdAt: "earlier" },
    { provider: "cerebras", last4: "metadata-1234", createdAt: "2026-11-22T10:00:00.000Z", ciphertext: "private-value" },
  ] });
  const view = await getSettingsView();
  assert.equal(view.cerebras.state, "saved");
  assert.equal(view.cerebras.last4, "1234");
  assert.equal(view.cerebras.savedAt, "2026-11-22T10:00:00.000Z");
  assert.equal(view.cerebras.validation, "not_checked");
  assert.deepEqual(Object.values(view.cerebras.actions), [false, true, true, true]);
  assert.doesNotMatch(JSON.stringify(view), /private-value|ciphertext|gpu|metadata-/);
});

test("missing persistent encryption prevents key use but permits removing a stored key", async () => {
  for (const keys of [[], [{ provider: "cerebras", last4: "1234", createdAt: "today" }]]) {
    const { getSettingsView } = loadView({ encryption: false, keys });
    const view = await getSettingsView();
    assert.equal(view.cerebras.state, "unavailable");
    assert.deepEqual(Object.values(view.cerebras.actions), [false, false, false, keys.length > 0]);
  }
});

test("identity and storage failures remain unavailable without returning diagnostic errors", async () => {
  for (const options of [{ user: new Error("private identity detail") }, { keys: new Error("private database detail") }]) {
    const { getSettingsView } = loadView(options);
    const view = await getSettingsView();
    assert.equal(view.cerebras.state, "unavailable");
    assertNoActions(view);
    assert.doesNotMatch(JSON.stringify(view), /private|detail/);
  }
});
