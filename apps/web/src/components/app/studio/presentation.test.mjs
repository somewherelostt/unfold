import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
const ts = createRequire(import.meta.url)("typescript");
const jsx = (type, props) => ({ type, props: props ?? {} });
const ui = (name) => (props) => jsx(name, props);
const text = (value) => Array.isArray(value) ? value.map(text).join(" ") : value && typeof value === "object" ? text(value.props?.children) : typeof value === "string" || typeof value === "number" ? String(value) : "";
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  if (typeof value.type === "function") return nodes(value.type(value.props));
  return [value, ...nodes(value.props.children)];
}
function load(relative, appended, imports) {
  const loaded = { exports: {} };
  const code = readFileSync(new URL(relative, import.meta.url), "utf8") + appended;
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module: loaded, exports: loaded.exports,
    require(name) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return loaded.exports;
}
function chat() {
  return load("./Chat.tsx", "\nexport { Pending, LiveRun, AgentMsg };", {
    react: { useState: (initial) => [typeof initial === "number" ? initial + 180000 : initial, () => {}], useEffect() {}, useRef: () => ({ current: null }) },
    "@/lib/client/store": { actions: {}, isActive: (run) => ["preparing", "queued", "generating"].includes(run.status), useStore: () => undefined },
    "@/lib/client/narrate": { planSteps: () => [] },
    "@/components/ui/Button": { Button: ui("button") },
    "@/components/ui/Shimmer": { Shimmer: ui("span") },
    "@/components/ui/SpeedBadge": { SpeedBadge: ui("metrics") },
    "@/components/ui/icons": Object.fromEntries(["IconArrowUp", "IconCheck", "IconChevronRight", "IconUndo"].map((name) => [name, ui("svg")])),
    "../ui": { cx: (...values) => values.filter(Boolean).join(" ") },
  });
}
test("long elapsed remix waits do not invent a provider queue or completion", () => {
  const rendered = chat().Pending({ startedAt: 1 });
  assert.match(text(rendered), /Waiting for your updated edit/);
  assert.match(text(rendered), /03:00/);
  assert.doesNotMatch(text(rendered), /Queued|complete|tokens/i);
});
test("received draft is described without estimated tokens", () => {
  const rendered = chat().Pending({ startedAt: 1, draft: "partial provider JSON" });
  assert.match(text(rendered), /Receiving your updated edit/);
  assert.doesNotMatch(text(rendered), /tokens|Queued/);
});
test("accepted request remains a neutral wait with actual elapsed time", () => {
  const rendered = chat().LiveRun({ run: { status: "queued", startedAt: 1, queuedAt: 100, slots: [] }, reveal: 0 });
  assert.match(text(rendered), /Waiting for your edit/);
  assert.match(text(rendered), /Elapsed/);
  assert.doesNotMatch(text(rendered), /Queued at|\d+%|rendering|Edit ready/i);
});
test("initial agent summary uses current plan facts instead of legacy incorrect cut count", () => {
  const rendered = chat().AgentMsg({ id: "owned", msg: { role: "agent", text: "40.9s edit, 1 cuts" }, initialPlan: { durationSec: 40.85, clips: [{}], rationale: "Preserve the original narration." } });
  assert.match(text(rendered), /Preserve the original narration/);
  assert.match(text(rendered), /40\.9\s+s ·\s+1\s+clip/);
  assert.doesNotMatch(text(rendered), /1 cuts/);
});
test("generation metrics are retained inside closed run details", () => {
  const rendered = chat().AgentMsg({ id: "owned", msg: { role: "agent", text: "Updated.", stats: { genMs: 400, tps: 700 } } });
  const detail = nodes(rendered).find((node) => node.type === "details");
  assert.ok(detail);
  assert.equal(detail.props.open, undefined);
  assert.equal(nodes(detail).find((node) => node.type === "metrics").props.seconds, 0.4);
});
function login(configured, bypass) {
  return load("../../../app/(auth)/login/page.tsx", "\nexport { LoginBody };", {
    react: { Suspense: ui("suspense") },
    "next/link": { default: ui("a") },
    "@/lib/auth/env": { isAuthConfigured: () => configured, isDevNoAuth: () => bypass, safeNext: (value) => value?.startsWith("/") ? value : "/app" },
    "../_components/brand": { Logo: ui("logo"), Notice: (props) => jsx("notice", { ...props, children: [props.title, props.children] }) },
    "./login-form": { LoginForm: ui("login-form") },
    "@/components/ui/Button": { buttonClasses: () => "button" },
    "@/components/app/app.css": {},
  });
}
test("unavailable sign-in renders a working continuation without a dead email form", async () => {
  const rendered = await login(false, true).LoginBody({ searchParams: Promise.resolve({ next: "/settings" }) });
  assert.match(text(nodes(rendered)), /Sign-in is unavailable/);
  assert.equal(nodes(rendered).some((node) => node.type === "login-form"), false);
  assert.equal(nodes(rendered).find((node) => node.type === "a").props.href, "/settings");
  assert.doesNotMatch(text(rendered), /UNFOLD_|Demo|build/);
});
test("configured expired-link recovery retains the actual login form", async () => {
  const rendered = await login(true, false).LoginBody({ searchParams: Promise.resolve({ error: "expired", next: "/app" }) });
  assert.match(text(rendered), /may have expired/);
  assert.ok(nodes(rendered).find((node) => node.type === "login-form"));
});
