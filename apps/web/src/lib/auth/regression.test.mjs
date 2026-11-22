import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");

// Load the real modules with isolated auth/storage boundaries; no server or network is needed.
function loadSource(path, { dependencies = {}, env = {}, globals = {} } = {}) {
  const filename = new URL(path, import.meta.url);
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loaded = { exports: {} };
  runInNewContext(outputText, {
    module: loaded,
    exports: loaded.exports,
    require: (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id),
    process: { env: { NODE_ENV: "test", ...env } },
    URL,
    Headers,
    Request,
    Response,
    AbortSignal,
    fetch: () => assert.fail("Unexpected network request"),
    ...globals,
  }, { filename: filename.pathname });
  return loaded.exports;
}

const authEnv = loadSource("./env.ts");

test("redirect destinations reject external origins, control characters and normalized double slashes", () => {
  const unsafe = [
    undefined, "", "https://elsewhere.invalid", "//elsewhere.invalid", "/\\elsewhere.invalid",
    "/\t/elsewhere.invalid", "/\n/elsewhere.invalid", "/\r/elsewhere.invalid", "/app\u0000",
    "/app\u007f", "/app/\\elsewhere.invalid", "/app/..//elsewhere.invalid",
  ];
  for (const next of unsafe) assert.equal(authEnv.safeNext(next), "/app", JSON.stringify(next));
});

test("redirect destinations preserve local paths, query strings and fragments", () => {
  assert.equal(authEnv.safeNext("/settings?tab=keys#cerebras"), "/settings?tab=keys#cerebras");
  assert.equal(authEnv.safeNext("/app/edit/clip?prompt=raw clip"), "/app/edit/clip?prompt=raw%20clip");
  assert.equal(authEnv.safeNext("/app/../settings"), "/settings");
});

function loadProxy({ signedIn = true, env = {} } = {}) {
  const configuredEnv = loadSource("./env.ts", {
    env: { NEXT_PUBLIC_UNFOLD_AUTH_URL: "https://auth.invalid", NEXT_PUBLIC_UNFOLD_AUTH_ANON_KEY: "public-test-key", ...env },
  });
  return loadSource("./proxy.ts", {
    dependencies: {
      "./env": configuredEnv,
      "@supabase/ssr": {
        createServerClient: (_url, _key, options) => ({
          auth: {
            getClaims: async () => {
              options.cookies.setAll([
                { name: "unfold-session", value: "refreshed-test-session", options: { path: "/", httpOnly: true, sameSite: "lax" } },
              ], { "Cache-Control": "private, no-store", Expires: "0" });
              return { data: { claims: signedIn ? { sub: "test-user" } : null } };
            },
          },
        }),
      },
    },
  });
}

function assertRefresh(response) {
  assert.equal(response.cookies.get("unfold-session")?.value, "refreshed-test-session");
  assert.equal(response.cookies.get("unfold-session")?.httpOnly, true);
  assert.equal(response.cookies.get("unfold-session")?.sameSite, "lax");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("expires"), "0");
  assert.equal(response.headers.get("x-middleware-next"), null);
}

test("signed-in login redirects preserve query strings, fragments and refreshed cookies", async () => {
  const { updateSession } = loadProxy();
  const next = "/app/edit/clip?panel=captions&speed=1#timeline";
  const response = await updateSession(new NextRequest(`https://unfold.invalid/login?next=${encodeURIComponent(next)}`));
  assert.equal(response.headers.get("location"), `https://unfold.invalid${next}`);
  assertRefresh(response);
});

test("signed-in login redirects reject the control-character origin bypass", async () => {
  const { updateSession } = loadProxy();
  const response = await updateSession(new NextRequest(`https://unfold.invalid/login?next=${encodeURIComponent("/\t/elsewhere.invalid")}`));
  assert.equal(response.headers.get("location"), "https://unfold.invalid/app");
  assertRefresh(response);
});

test("signed-out protected redirects preserve the requested path and session updates", async () => {
  const { updateSession } = loadProxy({ signedIn: false });
  const response = await updateSession(new NextRequest("https://unfold.invalid/settings?tab=keys"));
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("next"), "/settings?tab=keys");
  assertRefresh(response);
});

test("unconfigured local demo stays accessible and the bypass remains disabled in production", async () => {
  for (const production of [false, true]) {
    const env = loadSource("./env.ts", { env: { UNFOLD_DEV_NO_AUTH: "1", NODE_ENV: production ? "production" : "development" } });
    const { updateSession } = loadSource("./proxy.ts", {
      dependencies: { "./env": env, "@supabase/ssr": { createServerClient: () => assert.fail("Auth must stay unconfigured") } },
    });
    const response = await updateSession(new NextRequest("https://unfold.invalid/app"));
    assert.equal(response.status, production ? 307 : 200);
    if (production) assert.equal(new URL(response.headers.get("location")).pathname, "/login");
    else assert.equal(response.headers.get("location"), null);
  }
});

test("successful auth callbacks validate destinations and preserve local query strings", async () => {
  const { GET } = loadSource("../../app/(auth)/auth/callback/route.ts", {
    dependencies: {
      "@/lib/auth/env": authEnv,
      "@/lib/auth/server": { createClient: async () => ({ auth: { exchangeCodeForSession: async () => ({ error: null }) } }) },
    },
  });
  for (const [next, expected] of [["/settings?tab=keys#cerebras", "/settings?tab=keys#cerebras"], ["/\t/elsewhere.invalid", "/app"]]) {
    const response = await GET(new NextRequest(`https://unfold.invalid/auth/callback?code=test-code&next=${encodeURIComponent(next)}`));
    assert.equal(response.headers.get("location"), `https://unfold.invalid${expected}`);
  }
});

test("provider validation rejects inherited object properties", () => {
  const { isProvider } = loadSource("./providers.ts");
  for (const provider of ["cerebras", "gpu"]) assert.equal(isProvider(provider), true);
  for (const provider of ["constructor", "__proto__", "toString", null, "unknown"]) assert.equal(isProvider(provider), false);
});

function loadKeyCheck({ storedKey = async () => "saved-test-key", user = { id: "test-user" }, fetch } = {}) {
  const providers = loadSource("./providers.ts");
  return loadSource("../../app/(app)/settings/actions.ts", {
    env: { CEREBRAS_API_KEY: "shared-test-key" },
    dependencies: {
      "next/cache": { revalidatePath: () => {} },
      "@/lib/auth/server": { getUser: async () => user },
      "@/lib/auth/providers": providers,
      "@/lib/auth/api-keys": {
        getStoredUserApiKey: storedKey,
        getUserApiKey: () => assert.fail("Key checks must not use a shared fallback"),
      },
    },
    globals: fetch ? { fetch } : {},
  });
}

test("key checks require sign-in before reading a saved key", async () => {
  const { testCerebrasKey } = loadKeyCheck({ user: null, storedKey: () => assert.fail("Signed-out key access") });
  const result = await testCerebrasKey();
  assert.equal(result.ok, false);
  assert.equal(result.message, "Sign in first.");
});

test("key checks do not use a shared key when no saved key exists", async () => {
  const { testCerebrasKey } = loadKeyCheck({ storedKey: async () => null });
  const result = await testCerebrasKey();
  assert.equal(result.ok, false);
  assert.equal(result.message, "No Cerebras key saved yet.");
});

test("unreadable saved keys produce an actionable failure without a fallback request", async () => {
  const { testCerebrasKey } = loadKeyCheck({ storedKey: async () => { throw new Error("test decryption failure"); } });
  const result = await testCerebrasKey();
  assert.equal(result.ok, false);
  assert.match(result.message, /Replace it and try again/);
});

test("key checks send the saved key and report rejected keys", async () => {
  const { testCerebrasKey } = loadKeyCheck({
    storedKey: async (userId, provider) => {
      assert.equal(userId, "test-user");
      assert.equal(provider, "cerebras");
      return "saved-test-key";
    },
    fetch: async (url, options) => {
      assert.equal(url, "https://api.cerebras.ai/v1/models");
      assert.equal(options.headers.Authorization, "Bearer saved-test-key");
      return new Response(null, { status: 401 });
    },
  });
  const result = await testCerebrasKey();
  assert.equal(result.ok, false);
  assert.equal(result.message, "Cerebras rejected this key.");
});

test("key checks confirm the selected Kimi model using the saved key", async () => {
  const { CEREBRAS_MODEL } = loadSource("./providers.ts");
  const { testCerebrasKey } = loadKeyCheck({ fetch: async () => Response.json({ data: [{ id: CEREBRAS_MODEL }] }) });
  const result = await testCerebrasKey();
  assert.equal(result.ok, true);
  assert.equal(result.message, "Saved key works. Kimi K3.1 Pro is available.");
});
