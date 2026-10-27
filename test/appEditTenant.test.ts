import assert from "node:assert/strict";
import test from "node:test";
import { editTenantFields, datasetsForEditTenant } from "../lib/appEditTenant.ts";
import { submitFromPage } from "./appCreateTenant.test.ts";

test("tenant ownership edit is explicit, superadmin-only, and leaves unassigned unchanged", () => {
  assert.deepEqual(editTenantFields(true, 1, "2"), { owner_tenant_id: 2 });
  assert.deepEqual(editTenantFields(true, 1, "1"), {});
  assert.deepEqual(editTenantFields(true, null, ""), {});
  assert.deepEqual(editTenantFields(false, 1, "2"), {});
  assert.throws(() => editTenantFields(true, 1, ""), /TENANT_REQUIRED/);
});

test("new tenant candidates preserve selected cross-tenant and missing bindings for removal", () => {
  const data = [
    { id: "old", name: "Old", owner_tenant_id: 1 },
    { id: "new", name: "New", owner_tenant_id: 2 },
    { id: "blocked", name: "Blocked", owner_tenant_id: 3 },
    { id: "public", name: "Public", visibility: "public" },
  ];
  assert.deepEqual(
    datasetsForEditTenant(data, ["old", "missing"], "2", true).map((d) => d.id),
    ["old", "new", "public", "missing"]
  );
});

test("actual edit callback sends changed tenant without default or silently replacing workflow", async () => {
  const changed = await submitFromPage(true, "9", true);
  assert.equal(changed.calls[0].payload.owner_tenant_id, 9);
  assert.equal("is_default" in changed.calls[0].payload, false);
  assert.equal((changed.workflowInputs[0] as { source: string }).source, "form");
  const ordinary = await submitFromPage(false, "9", true);
  assert.equal("owner_tenant_id" in ordinary.calls[0].payload, false);
  const unchanged = await submitFromPage(true, "8", true);
  assert.equal("owner_tenant_id" in unchanged.calls[0].payload, false);
  const unassigned = await submitFromPage(true, "", true, { originalTenant: null });
  assert.equal("owner_tenant_id" in unassigned.calls[0].payload, false);
});

test("default-only editor remains limited and migration errors leave editor open", async () => {
  const limited = await submitFromPage(false, "9", true, { defaultOnly: true });
  assert.deepEqual(Object.keys(limited.calls[0].payload), ["is_default"]);
  const denied = await submitFromPage(true, "9", true, { fail: true });
  assert.deepEqual(denied.errors, ["Incompatible dataset binding"]);
  assert.equal(denied.closed, false);
});

test("actual tenant change handler preserves the prior default choice when switching back", async () => {
  const ts = (await import("typescript")).default;
  const { readFileSync } = await import("node:fs");
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
      node.name.getText(source) === "handleCreateTenantChange" &&
      node.initializer
    )
      callback = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  for (const chosenDefault of [true, false]) {
    let form = { is_default: chosenDefault };
    let selected = "8";
    const module = { exports: null as unknown };
    vm.runInNewContext(
      ts.transpileModule(`module.exports = ${callback};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
      }).outputText,
      {
        module,
        editingApp: { owner_tenant_id: 8 },
        setEditTenantId: (id: string) => {
          selected = id;
        },
        setFormData: (update: (previous: typeof form) => typeof form) => {
          form = update(form);
        },
      }
    );
    const change = module.exports as (tenantId: string) => void;
    change("9");
    change("8");
    assert.equal(selected, "8");
    assert.equal(form.is_default, chosenDefault);
  }
});
