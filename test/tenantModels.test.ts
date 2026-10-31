import { submitFromPage } from "./appCreateTenant.test.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  modelPayload,
  modelCatalogUrl,
  modelCatalogAccess,
  type ModelDraft,
} from "../lib/tenantModels.ts";
import { checkSuperAdmin, checkTenantAdmin } from "../lib/clientPermissions.ts";

const draft: ModelDraft = {
  display_name: "Local Qwen",
  api_model: "Qwen3.8-Flash-Next",
  base_url: "http://fixture:8086/v1",
  auth_mode: "none",
  api_key: "",
  clear_api_key: false,
  supports_tools: true,
  supports_images: false,
  enabled: true,
};

test("key payload is write-only, retained when omitted, removed only explicitly", () => {
  assert.equal("api_key" in modelPayload(draft, true, 2), false);
  assert.equal("owner_tenant_id" in modelPayload(draft, true, 2), false);
  assert.equal(modelPayload(draft, false, 2).owner_tenant_id, 2);
  assert.equal(
    modelPayload({ ...draft, auth_mode: "bearer", api_key: "new fixture key" }, true).api_key,
    "new fixture key"
  );
  const cleared = modelPayload(
    { ...draft, clear_api_key: true, auth_mode: "bearer", api_key: "discard" },
    true
  );
  assert.equal(cleared.clear_api_key, true);
  assert.equal(cleared.auth_mode, "none");
  assert.equal("api_key" in cleared, false);
  assert.equal(modelCatalogUrl(7), "/api/v1/llm-models?owner_tenant_id=7");
});

function manager(user: any, editDraft: ModelDraft | null = null) {
  let cursor = 0;
  const model = {
    code: "custom-fixture",
    ...draft,
    owner_tenant_id: 2,
    has_api_key: true,
    api_key: "must-never-render",
  };
  const state: any[] = ["2", [], [model], editDraft ? model : null, editDraft, false, "", 0];
  const calls: any[] = [];
  const jsx = (type: any, props: any) => ({ type, props });
  const module = { exports: {} as any };
  const mocks: any = {
    "@/app/components/WorkspaceProvider": { useWorkspace: () => ({ enabled: false, tenant: null }) },
    react: {
      useEffect() {},
      useState() {
        const i = cursor++;
        return [
          state[i],
          (v: any) => {
            state[i] = typeof v === "function" ? v(state[i]) : v;
          },
        ];
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next-intl": { useTranslations: () => (v: string) => v },
    "@/hooks/useCurrentUser": { useCurrentUser: () => ({ user }) },
    "@/lib/clientPermissions": { checkSuperAdmin, checkTenantAdmin },
    "@/lib/tenantModels": { modelPayload },
    "@/lib/axios": {
      default: {
        patch: async (url: string, body: any) => calls.push({ url, body }),
        post: async (url: string, body: any) => calls.push({ url, body }),
      },
    },
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/card": {
      Card: "card",
      CardHeader: "header",
      CardTitle: "title",
      CardContent: "section",
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../components/TenantModelsManager.tsx", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }
    ).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) => {
        if (!(id in mocks)) throw Error(id);
        return mocks[id];
      },
      Event: class {},
      window: { dispatchEvent() {}, confirm: () => true },
    }
  );
  const render = () => {
    cursor = 0;
    return module.exports.TenantModelsManager();
  };
  const nodes = (tree: any): any[] =>
    !tree
      ? []
      : Array.isArray(tree)
        ? tree.flatMap(nodes)
        : typeof tree === "object"
          ? [tree, ...nodes(tree.props?.children)]
          : [];
  return { render, nodes, calls, state };
}

test("actual manager hides controls for ordinary users and never renders stored key", () => {
  assert.equal(manager({ id: 1, roles: [] }).render(), null);
  for (const role of ["租户管理员", "超级管理员"]) {
    const h = manager({ id: 1, roles: [role] });
    const tree = h.render();
    assert.ok(tree);
    assert.equal(JSON.stringify(tree).includes("must-never-render"), false);
    h.nodes(tree)
      .find((node) => node.type === "button" && node.props.children === "tenantModelsEdit")
      .props.onClick();
    const inputs = h
      .nodes(h.render())
      .filter((node) => node.type === "input" && node.props.type === "password");
    // No-auth model has no key input until authentication is selected; saved value is never loaded into draft.
    assert.equal(h.state[4].api_key, "");
    assert.equal(inputs.length, 0);
  }
});

test("actual save callback uses current tenant, retains old key and sends only safe fields", async () => {
  const h = manager({ id: 1, roles: ["租户管理员"] }, { ...draft, auth_mode: "bearer" });
  const form = h.nodes(h.render()).find((node) => node.type === "form");
  form.props.onSubmit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.length, 1);
  assert.equal("api_key" in h.calls[0].body, false);
  assert.equal("has_api_key" in h.calls[0].body, false);
  assert.equal("owner_tenant_id" in h.calls[0].body, false);
});

test("real app submission blocks an unavailable tenant model rather than silently replacing it", async () => {
  const stale = await submitFromPage(true, "9", true, { modelCode: "custom-old-tenant" });
  assert.equal(stale.calls.length, 0);
  assert.deepEqual(stale.errors, ["modelUnavailable"]);
  const available = await submitFromPage(true, "9", true, {
    modelCode: "custom-new-tenant",
    models: [{ code: "custom-new-tenant" }],
  });
  assert.equal(available.calls[0].payload.ai_model, "custom-new-tenant");
});

test("actual catalog hook refreshes tenant scope and ignores a late previous tenant result", async () => {
  let state: any = { scope: "", items: [] },
    deps: unknown[] = [],
    cleanup: (() => void) | undefined;
  const pending: { url: string; resolve: (value: any) => void }[] = [];
  const listeners = new Map<string, () => void>();
  const module = { exports: {} as any };
  const mocks: any = {
    "@/app/components/WorkspaceProvider": { useWorkspace: () => ({ enabled: false, tenant: null }) },
    react: {
      useState: () => [
        state,
        (value: unknown) => {
          state = value;
        },
      ],
      useEffect: (effect: () => () => void, next: unknown[]) => {
        if (next.some((v, i) => v !== deps[i])) {
          cleanup?.();
          deps = next;
          cleanup = effect();
        }
      },
    },
    "@/lib/tenantModels": { modelCatalogUrl },
    "@/lib/axios": {
      default: { get: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) },
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../hooks/useTenantModelCatalog.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } }
    ).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) => mocks[id],
      window: {
        addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
        removeEventListener: (name: string) => listeners.delete(name),
      },
    }
  );
  assert.deepEqual(Array.from(module.exports.useTenantModelCatalog(1)), []);
  assert.deepEqual(Array.from(module.exports.useTenantModelCatalog(2)), []);
  pending[0].resolve({ data: { items: [{ code: "custom-tenant1" }] } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Array.from(module.exports.useTenantModelCatalog(2)), []);
  pending[1].resolve({ data: { items: [{ code: "builtin" }, { code: "custom-tenant2" }] } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    module.exports.useTenantModelCatalog(2).map((item: any) => item.code),
    ["builtin", "custom-tenant2"]
  );
  listeners.get("ragent:models-updated")?.();
  assert.equal(pending.length, 3);
  assert.equal(pending[2].url, "/api/v1/llm-models?owner_tenant_id=2");
  assert.deepEqual(Array.from(module.exports.useTenantModelCatalog(1, false)), []);
  assert.equal(pending[3].url, "/api/v1/llm-models?include_custom=false");
  pending[3].resolve({ data: { items: [{ code: "builtin" }, { code: "custom-wrong-tenant" }] } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    module.exports.useTenantModelCatalog(1, false).map((item: any) => item.code),
    ["builtin"]
  );
  cleanup?.();
});

test("tenant 2 creator editing tenant 1 gets only platform catalog; superadmin keeps explicit owner scope", () => {
  assert.deepEqual(modelCatalogAccess(2, false, 1), { tenantId: null, includeCustom: false });
  assert.deepEqual(modelCatalogAccess(2, false, null), { tenantId: null, includeCustom: false });
  assert.deepEqual(modelCatalogAccess(2, false, 2), { tenantId: 2, includeCustom: true });
  assert.deepEqual(modelCatalogAccess(2, true, 1), { tenantId: 1, includeCustom: true });
  assert.equal(modelCatalogUrl(null, false), "/api/v1/llm-models?include_custom=false");
});

test("actual cross-tenant app edit permits platform model but rejects viewer-tenant custom model even if catalog is stale", async () => {
  const denied = await submitFromPage(false, "1", true, {
    originalTenant: 1,
    includeCustom: false,
    modelCode: "custom-tenant2",
    models: [{ code: "custom-tenant2" }],
  });
  assert.equal(denied.calls.length, 0);
  assert.deepEqual(denied.errors, ["modelUnavailable"]);
  const platform = await submitFromPage(false, "1", true, {
    originalTenant: 1,
    includeCustom: false,
    modelCode: "deepseek-flash",
  });
  assert.equal(platform.calls[0].payload.ai_model, "deepseek-flash");
  assert.equal("owner_tenant_id" in platform.calls[0].payload, false);
});
