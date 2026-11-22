import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
const ts = createRequire(import.meta.url)("typescript");
const source = readFileSync(new URL("./PublishingWorkspace.tsx", import.meta.url), "utf8");
const region = source.slice(source.indexOf("function Calendar("), source.indexOf("function initialInput("));
const dayKey = source.match(/^const dayKey[^\n]+/m)[0];
const jsx = (type, props) => ({ type, props: props ?? {} });
const text = (value) => Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" ? text(value.props.children) : typeof value === "string" || typeof value === "number" ? String(value) : "";
function calendar({ date = [2026, 10, 22], posts = [] } = {}) {
  let cursor = 0;
  const hooks = [], calls = [], props = { posts, selected: null, onSelect(value) { calls.push(value); props.selected = value; } };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [...date, 12])); } }
  const loaded = { exports: {} };
  const script = `import { useState } from "react"; import { Button } from "button"; import { Panel } from "panel"; ${dayKey} ${region} export { Calendar };`;
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module: loaded, exports: loaded.exports, Date: Clock,
    require(name) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return { useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], (value) => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; } };
      if (name === "button") return { Button: (p) => jsx("button", p) };
      if (name === "panel") return { Panel: (p) => jsx("section", p) };
      throw new Error(`Unexpected ${name}`);
    },
  });
  function nodes(value) { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object") return []; if (typeof value.type === "function") return nodes(value.type(value.props)); return [value, ...nodes(value.props.children)]; }
  function render() { cursor = 0; return nodes(loaded.exports.Calendar(props)); }
  const days = () => render().filter((n) => n.type === "button" && /^\d{4}-\d{2}-\d{2},/.test(n.props["aria-label"] ?? ""));
  const button = (label) => render().find((n) => n.type === "button" && n.props["aria-label"] === label);
  const day = (key) => days().find((n) => n.props["aria-label"].startsWith(`${key},`));
  return { render, days, button, day, calls, title: () => text(render().find((n) => n.type === "h2")) };
}

test("all viewports use a real six-week month without a native date-input fallback", () => {
  const ui = calendar();
  assert.equal(ui.days().length, 42);
  assert.equal(ui.days()[0].props["aria-label"], "2026-11-01, 0 posts");
  assert.equal(ui.days().at(-1).props["aria-label"], "2026-12-12, 0 posts");
  assert.equal(new Set(ui.days().map((n) => n.props["aria-label"])).size, 42);
  assert.equal(ui.render().some((n) => n.type === "input" && n.props.type === "date"), false);
});
test("previous/next navigation crosses years while keeping six complete weeks", () => {
  const ui = calendar({ date: [2026, 11, 1] });
  ui.button("Next month").props.onClick(); assert.equal(ui.title(), "January 2027"); assert.equal(ui.days().length, 42);
  ui.button("Previous month").props.onClick(); assert.equal(ui.title(), "December 2026"); assert.equal(ui.days().length, 42);
});
test("February renders real leap-year dates rather than overflowing into a different day", () => {
  const leap = calendar({ date: [2028, 1, 1] }), ordinary = calendar({ date: [2027, 1, 1] });
  assert.ok(leap.day("2028-02-29")); assert.equal(ordinary.day("2027-02-29"), undefined);
  assert.equal(leap.days().length, ordinary.days().length);
});
test("selecting a day filters by its exact key and clicking it again clears the filter", () => {
  const ui = calendar(); ui.day("2026-11-22").props.onClick(); assert.deepEqual(ui.calls, ["2026-11-22"]);
  assert.equal(ui.day("2026-11-22").props["aria-pressed"], true);
  ui.day("2026-11-22").props.onClick(); assert.equal(ui.calls.at(-1), null);
});
test("an adjacent-month date changes the visible month and retains the exact selection", () => {
  const ui = calendar(); assert.equal(ui.day("2026-12-01").props["data-outside"], true);
  ui.day("2026-12-01").props.onClick(); assert.equal(ui.title(), "December 2026");
  assert.equal(ui.calls.at(-1), "2026-12-01"); assert.equal(ui.day("2026-12-01").props["aria-pressed"], true);
});
test("post markers retain scheduled local-date and immediate UTC-date grouping", () => {
  const ui = calendar({ posts: [
    { schedule: { mode: "scheduled", localDateTime: "2026-11-22T23:30" }, createdAt: Date.UTC(2026, 10, 20) },
    { schedule: { mode: "now" }, createdAt: Date.UTC(2026, 10, 22, 12) },
  ] });
  assert.equal(ui.day("2026-11-22").props["aria-label"], "2026-11-22, 2 posts");
  assert.equal(ui.day("2026-11-21").props["aria-label"], "2026-11-21, 0 posts");
});
test("today is announced independently from the selected filter", () => {
  const ui = calendar(); assert.equal(ui.day("2026-11-22").props["aria-current"], "date");
  assert.equal(ui.day("2026-11-22").props["aria-pressed"], false);
});
