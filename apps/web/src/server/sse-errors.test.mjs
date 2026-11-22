import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./test-loader.mjs";

test("opt-in SSE error serialization exposes only the supplied safe metadata", async () => {
  const { sse } = sourceLoader()("./sse.ts");
  const response = sse(async () => { throw new Error("fixture raw provider credential detail"); }, new AbortController().signal, () => ({ message: "Safe service failure", errorCode: "SAFE_FIXTURE", retryable: false }));
  const text = await response.text();
  assert.match(text, /"errorCode":"SAFE_FIXTURE"/);
  assert.match(text, /"retryable":false/);
  assert.equal(text.includes("credential detail"), false);
  assert.match(text, /event: done/);
});

test("a failed safe serializer never falls back to the original exception text", async () => {
  const { sse } = sourceLoader()("./sse.ts");
  const response = sse(async () => { throw new Error("fixture original private detail"); }, new AbortController().signal, () => { throw new Error("fixture formatter private detail"); });
  const text = await response.text();
  assert.match(text, /The request could not be completed/);
  assert.equal(text.includes("private detail"), false);
  assert.match(text, /event: done/);
});
