import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clearTenantBindings,
  createTenantFields,
  datasetsForCreateTenant,
} from "../lib/appCreateTenant.ts";

test("only a super administrator sends a creation tenant and must select a positive ID", () => {
  assert.deepEqual(createTenantFields(false, "999"), {});
  assert.deepEqual(createTenantFields(false, ""), {});
  assert.deepEqual(createTenantFields(true, "12"), { owner_tenant_id: 12 });
  for (const value of ["", "0", "-1", "1.5", "oops"]) {
    assert.throws(() => createTenantFields(true, value), /TENANT_REQUIRED/);
  }
});

test("creation data candidates cannot retain another tenant or unknown tenant resources", () => {
  const data = [
    { id: "mine", owner_tenant_id: 1 },
    { id: "other", owner_tenant_id: 2 },
    { id: "unknown" },
    { id: "public", owner_tenant_id: 3, visibility: "public" },
  ];
  assert.deepEqual(datasetsForCreateTenant(data, true, false, "2"), [data[1], data[3]]);
  assert.deepEqual(datasetsForCreateTenant(data, true, false, ""), []);
  assert.equal(datasetsForCreateTenant(data, true, true, "2"), data);
  assert.equal(datasetsForCreateTenant(data, false, false, "2"), data);
});

test("changing creation tenant clears resource bindings while preserving other inputs", () => {
  const previous = {
    name: "employee",
    dataset_ids: ["tenant1"],
    settings: { wechat: { agent_id: 1 }, workflow: { nodes: [] }, view_key: "dashboard" },
  };
  const next = clearTenantBindings(previous);
  assert.equal(next.name, "employee");
  assert.deepEqual(next.dataset_ids, []);
  assert.deepEqual(next.settings, { view_key: "dashboard", auto_select_datasets: true });
  assert.deepEqual(previous.dataset_ids, ["tenant1"]);
});

test("normal and template creation include validated tenant; edit does not send ownership", () => {
  const page = readFileSync(new URL("../app/apps/page.tsx", import.meta.url), "utf8");
  assert.match(page, /tenantSelector = isSuperAdmin && !editingApp/);
  assert.match(page, /setCreateTenantId\(user\?\.tenant_id \? String\(user.tenant_id\) : ""\)/);
  assert.match(
    page,
    /axios\.post\("\/api\/v1\/apps", \{ \.\.\.submitData, \.\.\.createTenantFields\(isSuperAdmin, createTenantId\) \}\)/
  );
  assert.match(
    page,
    /axios\.post\("\/api\/v1\/apps", \{ \.\.\.qualityAgentData, \.\.\.createTenantFields\(isSuperAdmin, createTenantId\) \}\)/
  );
  assert.match(page, /axios\.put\(`\/api\/v1\/apps\/\$\{editingApp.id\}`, submitData\)/);
});

// Execute the page's actual submission callback, rather than a second payload implementation.
async function submitFromPage(isSuperAdmin: boolean, tenantId: string, editing = false) {
  const ts = (await import("typescript")).default;
  const vm = await import("node:vm");
  const source = ts.createSourceFile(
    "page.tsx",
    readFileSync(new URL("../app/apps/page.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let callback = "";
  function visit(node: import("typescript").Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "handleSubmit" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      callback = node.initializer.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  const module = { exports: null as unknown };
  const result = ts.transpileModule(`module.exports = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  vm.runInNewContext(result.outputText, {
    module,
    isSuperAdmin,
    createTenantId: tenantId,
    editingApp: editing ? { id: 9, settings: {} } : null,
    formData: { name: "Employee", settings: {}, dataset_ids: [], is_default: false },
    autoSelectDatasets: true,
    datasets: [],
    defaultOnlyEditing: false,
    user: { id: 2 },
    createTenantFields,
    syncFormToWorkflow: () => ({ nodes: [] }),
    canManageTenantDefault: () => false,
    setSubmitting() {},
    setDialogOpen() {},
    loadApps() {},
    t: (key: string) => key,
    tc: (key: string) => key,
    toast: { success() {}, error: (message: string) => errors.push(message) },
    axios: {
      post: async (_url: string, payload: Record<string, unknown>) =>
        calls.push({ method: "POST", payload }),
      put: async (_url: string, payload: Record<string, unknown>) =>
        calls.push({ method: "PUT", payload }),
    },
  });
  await (module.exports as () => Promise<void>)();
  return { calls, errors };
}

test("real creation callback includes chosen tenant only for superadmins and requires a choice", async () => {
  const selected = await submitFromPage(true, "8");
  assert.equal(selected.calls[0].payload.owner_tenant_id, 8);
  const ordinary = await submitFromPage(false, "8");
  assert.equal("owner_tenant_id" in ordinary.calls[0].payload, false);
  const missing = await submitFromPage(true, "");
  assert.equal(missing.calls.length, 0);
  assert.deepEqual(missing.errors, ["createTenantRequired"]);
  const edited = await submitFromPage(true, "8", true);
  assert.equal(edited.calls[0].method, "PUT");
  assert.equal("owner_tenant_id" in edited.calls[0].payload, false);
});
