import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../app/skills/components/SkillSharedEnvPanel.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function setup(canManage) {
  const calls = [];
  let index = 0;
  const state = [];
  const config = {
    can_manage: canManage, revision: 4, shareable_keys: ["ID", "TOKEN"],
    configured_keys: ["ID", "TOKEN"], use_organization: false,
  };
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const deps = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    react: { useState: (initial) => {
      const i = index++;
      if (!(i in state)) state[i] = initial;
      return [state[i], (update) => { state[i] = typeof update === "function" ? update(state[i]) : update; }];
    } },
    "next-intl": { useTranslations: () => (key) => key },
    "@/components/ui/switch": { Switch: "Switch" },
    "@/components/ui/button": { Button: "button" }, "@/components/ui/input": { Input: "input" },
    sonner: { toast: { success() {} } },
    "@/lib/axios": { default: { put: async (url, body) => { calls.push({ url, body }); return { data: config }; } } },
  };
  runInNewContext(code, { module, exports: module.exports, require: (key) => deps[key] });
  function flatten(tree) {
    if (Array.isArray(tree)) return tree.flatMap(flatten);
    return tree?.props ? [tree, ...flatten(tree.props.children)] : [];
  }
  function render() {
    index = 0;
    return flatten(module.exports.default({ config, url: "/shared-env", update: async () => {} }));
  }
  return { render, calls, config };
}

test("members toggle organization settings without management controls", async () => {
  const h = setup(false);
  const view = h.render();
  assert.ok(!view.some((el) => el.props.children === "sharedManage"));
  await view.find((el) => el.type === "Switch").props.onCheckedChange(true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    { url: "/shared-env/preferences", body: { revision: 4, use_organization: true } },
  ]);
});

test("an admin rotates one value without overwriting the other saved value", async () => {
  const h = setup(true);
  h.render().find((el) => el.props.children === "sharedManage").props.onClick();
  const view = h.render();
  const secretInputs = view.filter((el) => el.type === "input" && el.props.type === "password");
  assert.deepEqual(secretInputs.map((el) => el.props.value), ["", ""]);
  secretInputs[1].props.onChange({ target: { value: "replacement" } });
  await h.render().find((el) => el.props.children === "sharedSave").props.onClick();
  const { body } = h.calls[0];
  assert.deepEqual(JSON.parse(JSON.stringify(body.values)), { TOKEN: "replacement" });
  assert.equal(body.revision, 4);
});

test("private skill visibility disables the shared query", () => {
  const file = readFileSync(new URL("../app/skills/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(file, /allowShared=\{skill\.visibility !== "private"\}/);
  const hooks = readFileSync(new URL("../hooks/useSkillUserEnv.ts", import.meta.url), "utf8");
  assert.match(hooks, /key && allowShared \? \[sharedUrl, scope\] : null/);
});

test("organization-provided rows show their source and restore the saved personal editor when switched off", () => {
  const source = readFileSync(new URL("../app/skills/components/SkillUserEnvPanel.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (type, props) => ({ type, props });
  const configured = { use_organization: true, configured_keys: ["TOKEN"] };
  const rows = [{ id: "token", key: "TOKEN", declared: true, value: "personal-value" }];
  const deps = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    react: {
      useState: (initial) => [Array.isArray(initial) ? rows : initial, () => {}],
      useEffect() {}, useMemo: (fn) => fn(),
    },
    "next-intl": { useTranslations: () => (key) => key },
    "@/hooks/useSkillUserEnv": { useSkillUserEnv: () => ({
      meta: { configurable: true }, env: { TOKEN: "personal-value" }, declaredKeys: ["TOKEN"],
      shared: { data: configured },
    }) },
    "@/lib/skillUserEnv": { validateEnvRows: () => ({ keyErrors: {}, valueErrors: {}, valid: true }), hasEnvChanges: () => false, isSecretEnvKey: () => true },
  };
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, require: (key) => deps[key] ?? new Proxy({}, { get: (_, name) => name }) });
  function flatten(node) {
    if (Array.isArray(node)) return node.flatMap(flatten);
    return node?.props ? [node, ...flatten(node.props.children)] : [];
  }
  const render = () => flatten(module.exports.default({ skillId: 28, allowShared: true, accessScope: "user:org" }));
  assert.ok(render().some((el) => el.props.children === "sharedActive"));
  assert.ok(!render().some((el) => el.props.value === "personal-value"));
  configured.use_organization = false;
  assert.ok(render().some((el) => el.props.value === "personal-value"));
  assert.ok(!render().some((el) => el.props.children === "sharedActive"));
});
