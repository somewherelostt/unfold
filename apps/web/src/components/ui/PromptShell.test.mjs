import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("./PromptShell.tsx", import.meta.url), "utf8");

/** Exercise the actual component handlers with isolated hook state and the external router replaced. */
function composer(props = {}) {
  let cursor = 0;
  const hooks = [];
  const submitted = [];
  const changed = [];
  const navigated = [];
  const element = (type, props) => ({ type, props: props ?? {} });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useRef() {
      const index = cursor++;
      hooks[index] ??= { current: { focus() {}, click() {} } };
      return hooks[index];
    },
    useId: () => "edit-brief",
    useEffect() {},
  };
  const loadedModule = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, {
    module: loadedModule, exports: loadedModule.exports, URLSearchParams, URL,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
      if (name === "next/navigation") return { useRouter: () => ({ push: (url) => navigated.push(url) }) };
      if (name === "./Chip") return { Chip: (props) => element("button", props) };
      if (name === "./icons") return Object.fromEntries(["IconArrowUp", "IconChevronDown", "IconPlus", "IconSparkle", "IconX"].map((name) => [name, () => element("svg", {})]));
      if (name === "./ui.css") return {};
      if (name === "./prompt-draft") return { savePromptDraft: async () => { throw new Error("Unexpected draft write"); } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const options = { onSubmit: (value) => submitted.push(value), onTextChange: (value) => changed.push(value), ...props };
  function expand(node) {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (!node || typeof node !== "object") return [];
    if (typeof node.type === "function") return expand(node.type(node.props));
    return [node, ...expand(node.props.children)];
  }
  function render() {
    cursor = 0;
    return expand(loadedModule.exports.PromptShell(options));
  }
  const find = (predicate) => {
    const node = render().find(predicate);
    assert.ok(node, "Expected composer control");
    return node;
  };
  return {
    render, submitted, changed, navigated,
    textarea: () => find((node) => node.type === "textarea"),
    button: (label) => find((node) => node.type === "button" && node.props["aria-label"] === label),
    submit: () => find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }),
  };
}

test("creative changes are explicit: the composer has no generic improve action", () => {
  const ui = composer({ defaultText: "Keep the original narration and natural pacing." });
  const buttons = ui.render().filter((node) => node.type === "button");
  assert.equal(buttons.some((node) => /improve/i.test(node.props["aria-label"] ?? node.props.title ?? "")), false);
  assert.equal(ui.textarea().props.value, "Keep the original narration and natural pacing.");
});

test("caption and aspect choices preserve a typed brief through submission", async () => {
  const ui = composer();
  const brief = "Preserve narration and natural pacing. No music or effects.";
  ui.textarea().props.onChange({ target: { value: brief } });
  ui.button("Caption style").props.onClick();
  ui.button("Aspect ratio").props.onClick();
  assert.equal(ui.textarea().props.value, brief);
  await ui.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.submitted[0])), { prompt: brief, file: null, style: "Pop", aspect: "1:1" });
  assert.deepEqual(ui.changed, [brief]);
});

test("a blank brief stays blank and does not acquire a viral direction", async () => {
  const ui = composer();
  await ui.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.submitted[0])), { prompt: "", file: null, style: "Auto", aspect: "9:16" });
  assert.deepEqual(ui.changed, []);
});

test("selecting a named preset remains an explicit text change", async () => {
  const prompt = "Keep the original sound and natural pacing.";
  const ui = composer({ defaultText: "An earlier brief", presets: [{ label: "Natural edit", prompt }] });
  const preset = ui.render().find((node) => node.type === "button" && node.props.children === "Natural edit");
  assert.ok(preset);
  preset.props.onClick();
  await ui.submit();
  assert.equal(ui.submitted[0].prompt, prompt);
  assert.deepEqual(ui.changed, [prompt]);
});

test("landing navigation carries the original brief without added creative instructions", async () => {
  const brief = "A quiet talking-head edit, with complete sentences.";
  const ui = composer({ defaultText: brief, onSubmit: undefined });
  await ui.submit();
  const route = new URL(ui.navigated[0], "http://localhost");
  assert.equal(route.pathname, "/app");
  assert.equal(route.searchParams.get("prompt"), brief);
  assert.equal(route.searchParams.get("style"), "Auto");
  assert.equal(route.searchParams.get("aspect"), "9:16");
});
