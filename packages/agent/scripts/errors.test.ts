import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { sampleAnalysis, sampleAgentPlans, sampleLibrary } from "@unfold/core";
import { generateVariants, remixPlan } from "../src/agent";
import { AgentServiceError, classifyAgentError, extractJson, isAgentServiceError, streamChat, type AgentErrorCode } from "../src/client";

const config = { url: "https://gateway-test.invalid", token: "fixture", agentId: "fixture" };
const context = { analysis: sampleAnalysis, library: sampleLibrary, config, loadFrame: async () => "data:image/jpeg;base64,fixture" };
const privateText = "PRIVATE_UPSTREAM_VALUE_DO_NOT_EXPOSE";
const sse = (text: string) => new Response(text, { headers: { "content-type": "text/event-stream" } });
const rejectsCode = (code: AgentErrorCode) => (error: unknown) => {
  assert.equal(isAgentServiceError(error), true);
  const typed = error as AgentServiceError;
  assert.equal(typed.code, code);
  assert.equal(typed.message.includes(privateText), false);
  assert.equal(typed.retryable, code !== "CANCELLED" && code !== "AUTH_REJECTED");
  return true;
};

test("trusted service errors survive realm copies while JSON and forged messages are rejected", () => {
  const local = new AgentServiceError("RATE_LIMITED");
  const brand = Object.getOwnPropertySymbols(local).find((key) => Symbol.keyFor(key) === "@unfold/agent/AgentServiceError")!;
  assert.equal(Object.getOwnPropertyDescriptor(local, brand)?.enumerable, false);
  const foreign = runInNewContext(`new (class extends Error {
    constructor() { super(message); this.code = code; this.retryable = retryable; this[Symbol.for(brand)] = true; }
  })()`, { message: local.message, code: local.code, retryable: local.retryable, brand: Symbol.keyFor(brand) });
  assert.equal(foreign instanceof AgentServiceError, false);
  assert.equal(isAgentServiceError(foreign), true);
  assert.equal(classifyAgentError(foreign).code, "RATE_LIMITED");
  assert.equal(isAgentServiceError({ code: local.code, message: local.message, retryable: local.retryable }), false);
  assert.equal(isAgentServiceError({ ...local, message: privateText }), false);
  assert.equal(isAgentServiceError({ ...local, message: local.message, code: "UNRECOGNIZED" }), false);
  assert.equal(isAgentServiceError({ ...local, message: local.message, retryable: false }), false);
  const forged = { code: local.code, message: privateText, retryable: true };
  Object.defineProperty(forged, brand, { value: true });
  assert.equal(isAgentServiceError(forged), false);
});

test("HTTP status classifies busy and auth without exposing response text or retrying", async () => {
  const previous = globalThis.fetch;
  try {
    for (const [status, code] of [[429, "RATE_LIMITED"], [503, "UNAVAILABLE"], [401, "AUTH_REJECTED"], [403, "AUTH_REJECTED"]] as const) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json({ error: { message: privateText } }, { status }); };
      await assert.rejects(streamChat([], config), rejectsCode(code));
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = previous; }
});

test("structured SSE error statuses and provider codes are preserved safely", async () => {
  const previous = globalThis.fetch;
  try {
    for (const [payload, code] of [
      [{ error: { status: 429, message: privateText } }, "RATE_LIMITED"],
      [{ error: { code: "rate_limit_exceeded", message: privateText } }, "RATE_LIMITED"],
      [{ error: { type: "overloaded_error", message: privateText } }, "UNAVAILABLE"],
      [{ error: { status: 503, message: privateText } }, "UNAVAILABLE"],
      [{ error: { code: "authentication_error", message: privateText } }, "AUTH_REJECTED"],
      [{ error: { message: "429 We're experiencing high traffic right now! " + privateText } }, "RATE_LIMITED"],
    ] as const) {
      globalThis.fetch = async () => sse(`data: ${JSON.stringify(payload)}\n\n`);
      await assert.rejects(streamChat([], config), rejectsCode(code));
    }
  } finally { globalThis.fetch = previous; }
});

test("empty or unknown responses never imply a busy provider or a bad key", async () => {
  const previous = globalThis.fetch;
  try {
    for (const response of [sse("data: [DONE]\n\n"), sse(`data: ${JSON.stringify({ error: { message: privateText } })}\n\n`), Response.json({ error: { message: privateText } }), Response.json({ error: { message: "high traffic without a known status" } }, { status: 500 })]) {
      globalThis.fetch = async () => response;
      await assert.rejects(streamChat([], config), rejectsCode("INVALID_RESPONSE"));
    }
  } finally { globalThis.fetch = previous; }
});

test("abort and transport failures are distinct and sanitized", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new DOMException(privateText, "AbortError"); };
    await assert.rejects(streamChat([], config), rejectsCode("CANCELLED"));
    globalThis.fetch = async () => { throw new TypeError(privateText); };
    await assert.rejects(streamChat([], config), rejectsCode("CONNECTION"));
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(privateText)); } }), { headers: { "content-type": "text/event-stream" } });
    await assert.rejects(streamChat([], config), rejectsCode("CONNECTION"));
  } finally { globalThis.fetch = previous; }
});

test("an error after partial output is not a successful edit, including at EOF", async () => {
  const previous = globalThis.fetch;
  try {
    const content = { choices: [{ delta: { content: '{"title":"partial"}' } }] };
    globalThis.fetch = async () => sse(`data: ${JSON.stringify(content)}\n\ndata: ${JSON.stringify({ error: { status: 503, message: privateText } })}`);
    await assert.rejects(streamChat([], config), rejectsCode("UNAVAILABLE"));
    globalThis.fetch = async () => sse(`data: ${JSON.stringify(content)}`);
    assert.equal((await streamChat([], config)).text, '{"title":"partial"}');
  } finally { globalThis.fetch = previous; }
});

test("malformed SSE and missing or invalid plan JSON have a typed safe failure", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => sse(`data: {not-json ${privateText}\n\n`);
    await assert.rejects(streamChat([], config), rejectsCode("INVALID_RESPONSE"));
    for (const value of ["", privateText, "{bad}", '{"title":']) assert.throws(() => extractJson(value), rejectsCode("INVALID_RESPONSE"));
    assert.equal(classifyAgentError(new Error(privateText)).message.includes(privateText), false);
  } finally { globalThis.fetch = previous; }
});

test("failed variants carry safe code, message and retryability", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: { message: privateText } }, { status: 429 });
    const results = [];
    for await (const result of generateVariants(context, "Natural story", { count: 1 })) results.push(result);
    assert.equal(results.length, 1);
    assert.equal(results[0].errorCode, "RATE_LIMITED");
    assert.equal(results[0].retryable, true);
    assert.equal(results[0].result, undefined);
    assert.equal(results[0].error, new AgentServiceError("RATE_LIMITED").message);
    globalThis.fetch = async () => sse(`data: ${JSON.stringify({ choices: [{ delta: { content: privateText } }] })}\n\n`);
    for await (const result of generateVariants(context, "Natural story", { count: 1 })) assert.equal(result.errorCode, "INVALID_RESPONSE");
  } finally { globalThis.fetch = previous; }
});

test("remix throws the same typed safe service failure", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => sse(`data: ${JSON.stringify({ error: { status: 503, message: privateText } })}\n\n`);
    await assert.rejects(remixPlan(context, sampleAgentPlans[1], "Keep my design"), rejectsCode("UNAVAILABLE"));
  } finally { globalThis.fetch = previous; }
});
