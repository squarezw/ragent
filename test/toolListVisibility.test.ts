import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { checkSuperAdmin, checkTenantAdmin } from "../lib/clientPermissions.ts";

function pageHarness(user: unknown, userLoading = false) {
  const state: any[] = [];
  let cursor = 0;
  let query: any;
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const module = { exports: {} as any };
  const source = readFileSync(new URL("../app/tools/page.tsx", import.meta.url), "utf8");
  const namedComponents = new Proxy({}, { get: (_target, name) => String(name) });
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module, exports: module.exports, console,
    require(name: string) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "react") return {
        useEffect() {},
        useState(initial: any) {
          const i = cursor++;
          if (!(i in state)) state[i] = initial;
          return [state[i], (next: any) => { state[i] = typeof next === "function" ? next(state[i]) : next; }];
        },
      };
      if (name === "next-intl") return { useTranslations: () => (key: string) => key };
      if (name === "next/navigation") return { useRouter: () => ({}) };
      if (name === "@/app/components/WorkspaceProvider") return { useWorkspace: () => ({ enabled: false }) };
      if (name === "@/hooks/useCurrentUser") return { useCurrentUser: () => ({ user, loading: userLoading }) };
      if (name === "@/lib/clientPermissions") return { checkSuperAdmin, checkTenantAdmin };
      if (name === "@/hooks/useBuiltinTools") return { useBuiltinTools: () => ({ builtins: [], meta: {}, loading: false }) };
      if (name === "@/hooks/useTools") return { useTools: (params: unknown) => {
        query = params;
        return { tools: [
          { id: 1, name: "enabled-fixture", display_name: "Enabled fixture", is_enabled: true, tool_type: "mcp" },
          { id: 2, name: "disabled-fixture", display_name: "Disabled fixture", is_enabled: false, tool_type: "mcp" },
        ], total: 41, loading: false };
      } };
      return namedComponents;
    },
  });
  return {
    render() { cursor = 0; return module.exports.default(); },
    query: () => query,
  };
}

function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test("ordinary and department administrators always request and display only enabled tools", () => {
  for (const user of [{ roles: [] }, { roles: ["部门管理员"] }, { roles: [{ name: "部门管理员" }] }]) {
    const h = pageHarness(user);
    const tree = h.render();
    assert.equal(h.query().is_enabled, true);
    assert.equal(nodes(tree).filter(node => node.type === "Select").length, 0);
    assert.ok(JSON.stringify(tree).includes("enabled-fixture"));
    assert.ok(!JSON.stringify(tree).includes("disabled-fixture"));
  }
});

test("user loading never requests all or reveals cached disabled rows", () => {
  for (const user of [null, { isSuperAdmin: true }, { isTenantAdmin: true }]) {
    const h = pageHarness(user, true);
    const tree = h.render();
    assert.equal(h.query().is_enabled, true);
    assert.equal(nodes(tree).filter(node => node.type === "Select").length, 0);
    assert.ok(!JSON.stringify(tree).includes("disabled-fixture"));
  }
});

test("loaded super and tenant administrators retain all/enabled/disabled filters", () => {
  for (const user of [{ roles: ["超级管理员"] }, { roles: [{ name: "租户管理员" }] }]) {
    const h = pageHarness(user);
    let tree = h.render();
    assert.equal(h.query().is_enabled, undefined);
    assert.ok(JSON.stringify(tree).includes("disabled-fixture"));
    for (const [value, expected] of [["enabled", true], ["disabled", false], ["all", undefined]] as const) {
      const select = nodes(tree).find(node => node.type === "Select");
      assert.ok(select);
      select.props.onValueChange(value);
      tree = h.render();
      assert.equal(h.query().is_enabled, expected);
    }
  }
});
