import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("./VisitorBadge.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function badge({ origin = "https://unfold.maazx.dev", storage = new Map(), failStorage = false, failWrites = false, fetcher = async () => Response.json({ count: 0 }) } = {}) {
  const hooks = [], requests = [], effects = [];
  let cursor = 0;
  const loaded = { exports: {} };
  const element = (type, props) => ({ type, props: props ?? {} });
  vm.runInNewContext(compiled, {
    module: loaded, exports: loaded.exports, AbortController, Number,
    window: { location: { origin }, crypto: { randomUUID }, localStorage: {
      getItem(key) { if (failStorage) throw new Error("Storage disabled"); return storage.get(key) ?? null; },
      setItem(key, value) { if (failStorage || failWrites) throw new Error("Storage disabled"); storage.set(key, value); },
    } },
    fetch: async (url, options) => { requests.push({ url, ...options }); return fetcher(url, options); },
    require(name) {
      if (name === "react") return {
        useState(value) { const index = cursor++; if (!(index in hooks)) hooks[index] = value; return [hooks[index], (next) => { hooks[index] = next; }]; },
        useEffect(effect) { if (!effects.length) effects.push(effect); },
      };
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => { cursor = 0; return loaded.exports.VisitorBadge(); };
  const initial = render();
  const cleanup = effects[0]();
  return { initial, render, requests, storage, cleanup, settle: () => new Promise(setImmediate) };
}
function words(node) {
  if (Array.isArray(node)) return node.map(words).join(" ");
  if (node && typeof node === "object") return words(node.props.children);
  return node == null ? "" : String(node);
}

test("a returning browser reuses its saved random ID while the badge shows the real total", async () => {
  const storage = new Map();
  const first = badge({ storage, fetcher: async () => Response.json({ count: 1234 }) });
  assert.ok(!words(first.initial).includes("0"));
  await first.settle();
  assert.match(words(first.render()), /1,234/);
  const firstId = JSON.parse(first.requests[0].body).visitorId;
  assert.match(firstId, /^[0-9a-f-]{36}$/);
  assert.equal(first.requests[0].method, "POST");
  const second = badge({ storage });
  await second.settle();
  assert.equal(JSON.parse(second.requests[0].body).visitorId, firstId);
  assert.equal(second.requests[0].credentials, "same-origin");
});

test("disabled storage and preview/local pages read only, without minting ephemeral counted visitors", async () => {
  for (const options of [{ failStorage: true }, { failWrites: true }, { origin: "http://localhost:3000" }, { origin: "https://preview.vercel.app" }]) {
    const ui = badge(options);
    await ui.settle();
    assert.equal(ui.requests[0].method, "GET");
    assert.equal(ui.requests[0].body, undefined);
    assert.match(words(ui.render()), /Visitors 0/);
  }
});

test("loading, real zero and service failure reserve the same badge dimensions", async () => {
  const zero = badge();
  const initialClass = zero.initial.props.className;
  assert.match(initialClass, /h-8/);
  assert.match(initialClass, /w-\[240px\]/);
  await zero.settle();
  assert.match(words(zero.render()), /Visitors 0/);
  assert.equal(zero.render().props.className, initialClass);
  for (const fetcher of [async () => { throw new Error("offline"); }, async () => new Response("", { status: 503 }), async () => Response.json({ count: -1 }), async () => Response.json({ count: "999" })]) {
    const failed = badge({ fetcher });
    await failed.settle();
    assert.match(words(failed.render()), /Visitors unavailable/);
    assert.equal(failed.render().props.className, initialClass);
  }
});

test("an unmounted badge aborts its request and ignores the late response", async () => {
  let resolve;
  const ui = badge({ fetcher: () => new Promise((done) => { resolve = done; }) });
  ui.cleanup();
  assert.equal(ui.requests[0].signal.aborted, true);
  resolve(Response.json({ count: 17 }));
  await ui.settle();
  assert.ok(!words(ui.render()).includes("17"));
});
