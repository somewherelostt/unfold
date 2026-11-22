import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sourceLoader } from "./test-loader.mjs";

function fixture() {
  const dependencies = {};
  const load = sourceLoader(dependencies);
  const agent = load("../../../../packages/agent/src/client.ts");
  dependencies["@unfold/agent"] = agent;
  return { ...agent, ...load("./agent-errors.ts") };
}

test("known agent failures retain distinct safe codes without exposing upstream text", () => {
  const { AgentServiceError, agentErrorPayload, variantErrorPayload } = fixture();
  for (const code of ["RATE_LIMITED", "UNAVAILABLE", "AUTH_REJECTED", "CANCELLED", "CONNECTION", "INVALID_RESPONSE"]) {
    const expected = new AgentServiceError(code);
    const error = new AgentServiceError(code);
    const safe = agentErrorPayload(error);
    assert.equal(safe.errorCode, code);
    assert.equal(safe.message, expected.message);
    assert.equal(safe.retryable, expected.retryable);
    assert.equal(JSON.stringify(safe).includes("credential detail"), false);
    assert.equal(variantErrorPayload(code).message, expected.message);
    error.message = "fixture raw credential detail";
    const tampered = agentErrorPayload(error);
    assert.ok(tampered.errorCode === undefined || tampered.errorCode === code);
    assert.equal(JSON.stringify(tampered).includes("credential detail"), false);
  }
});

test("unknown failures, status-like strings and untyped objects never imply busy or bad credentials", () => {
  const { agentErrorPayload, variantErrorPayload } = fixture();
  for (const error of [new Error("429 fixture raw secret"), { code: "RATE_LIMITED", message: "fixture secret" }, null]) {
    const safe = agentErrorPayload(error);
    assert.equal(safe.errorCode, undefined);
    assert.equal(safe.retryable, false);
    assert.doesNotMatch(safe.message, /busy|rate.limit|key|credential|secret/i);
  }
  assert.equal(variantErrorPayload("FUTURE_UNKNOWN").errorCode, undefined);
});

test("actual request cancellation overrides another failure without retaining its abort reason", () => {
  const { AgentServiceError, agentErrorPayload } = fixture();
  const controller = new AbortController();
  controller.abort("fixture private cancellation detail");
  const safe = agentErrorPayload(new AgentServiceError("AUTH_REJECTED"), controller.signal);
  assert.equal(safe.errorCode, "CANCELLED");
  assert.equal(safe.retryable, false);
  assert.equal(JSON.stringify(safe).includes("private cancellation detail"), false);
});

test("native react-server imports preserve typed errors across module instances without exposing raw messages", () => {
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const loader = fileURLToPath(new URL("../../../../packages/video/node_modules/tsx/dist/loader.mjs", import.meta.url));
  const script = `
    import assert from 'node:assert/strict';
    import {AgentServiceError} from '@unfold/agent';
    import {agentErrorPayload} from './src/server/agent-errors.ts';
    for (const code of ['RATE_LIMITED','UNAVAILABLE','AUTH_REJECTED','CANCELLED','CONNECTION','INVALID_RESPONSE']) {
      const error = new AgentServiceError(code);
      const safe = agentErrorPayload(error);
      assert.equal(safe.errorCode, code);
      assert.equal(safe.message.includes('private detail'), false);
      error.message = 'fixture upstream private detail';
      const tampered = agentErrorPayload(error);
      assert.ok(tampered.errorCode === undefined || tampered.errorCode === code);
      assert.equal(tampered.message.includes('private detail'), false);
    }
    assert.equal(agentErrorPayload({name:'AgentServiceError',code:'RATE_LIMITED',message:'fixture raw detail'}).errorCode, undefined);
    console.log('native-safe-errors-ok');
  `;
  const output = execFileSync(process.execPath, ["--conditions=react-server", "--import", loader, "--input-type=module", "-e", script], { cwd, encoding: "utf8" });
  assert.match(output, /native-safe-errors-ok/);
});
