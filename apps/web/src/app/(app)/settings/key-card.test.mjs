import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
const ts = createRequire(import.meta.url)("typescript");
const source = readFileSync(new URL("./key-card.tsx", import.meta.url), "utf8");

/** Real component handlers with isolated state and mocked external actions; no provider calls. */
function card(overrides = {}, result = { ok: true, message: "Model access verified.", ms: 42 }) {
  let cursor = 0, checks = 0;
  const hooks = [], jsx = (type, props) => ({ type, props: props ?? {} }), actionState = {};
  const react = {
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], (value) => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useActionState: () => [actionState, async () => {}, false],
    useTransition: () => [false, (work) => work()],
  };
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module: loaded, exports: loaded.exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@/components/ui/Button") return { Button: (props) => jsx("button", props) };
      if (name === "./actions") return { saveKey() {}, removeKey: async () => ({ ok: true }), testCerebrasKey: async () => { checks++; return result; } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const props = { provider: "cerebras", label: "Cerebras", description: "Editing connection", placeholder: "csk-…", docsUrl: null, required: true, testable: true, last4: null, actions: { save: true, check: false, replace: false, remove: false }, ...overrides };
  function nodes(value) { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object") return []; return typeof value.type === "function" ? nodes(value.type(value.props)) : [value, ...nodes(value.props.children)]; }
  function render() { cursor = 0; return nodes(loaded.exports.KeyCard(props)); }
  const text = (value) => Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" ? text(value.props.children) : typeof value === "string" ? value : "";
  return { render, button: (label) => render().find((node) => node.type === "button" && text(node.props.children) === label), content: () => text(render()[0]), checks: () => checks };
}
const saved = { last4: "1234", actions: { save: false, check: true, replace: true, remove: true } };
test("disconnected account exposes the supported save action", () => {
  const ui = card(); assert.ok(ui.button("Save key")); assert.equal(ui.button("Check connection"), undefined); assert.match(ui.content(), /Not connected/);
});
test("a stored key is saved without claiming verified access", () => {
  const ui = card(saved); assert.match(ui.content(), /Key saved/); assert.doesNotMatch(ui.content(), /Access verified/); assert.ok(ui.button("Check connection"));
});
test("replace uses replace capability when new-key save is unavailable", () => {
  const ui = card(saved); ui.button("Replace key").props.onClick(); assert.ok(ui.button("Save key")); assert.ok(ui.button("Cancel")); assert.ok(ui.render().find((node) => node.type === "input" && node.props.name === "key"));
});
test("unavailable connection retains allowed removal without save or check", () => {
  const ui = card({ unavailable: true, last4: "1234", actions: { save: false, check: false, replace: false, remove: true } });
  assert.match(ui.content(), /Unavailable/); assert.ok(ui.button("Remove")); for (const label of ["Save key", "Check connection", "Replace key"]) assert.equal(ui.button(label), undefined);
});
test("only an explicit successful check establishes verified access", async () => {
  const ui = card(saved); assert.equal(ui.checks(), 0); await ui.button("Check connection").props.onClick(); assert.equal(ui.checks(), 1); assert.match(ui.content(), /Access verified/);
});
test("rejected saved-key check displays attention and an error", async () => {
  const ui = card(saved, { ok: false, message: "Cerebras rejected this key." }); await ui.button("Check connection").props.onClick(); assert.match(ui.content(), /Needs attention/); assert.doesNotMatch(ui.content(), /Access verified/); assert.ok(ui.render().find((node) => node.props.role === "alert"));
});
