import assert from "node:assert/strict";
import test from "node:test";
import { submitFromPage } from "./appCreateTenant.test.ts";

for (const editing of [false, true]) {
  test(`${editing ? "edit" : "create"} submits selected department only after matching tenant options load`, async () => {
    const result = await submitFromPage(true, "8", editing, {
      visibility: "dept",
      departmentId: 3,
      departments: [{ id: 3, name: "Engineering" }],
    });
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].payload.owner_dept_id, 3);
    for (const options of [
      { departmentId: null },
      { departmentId: 99 },
      { departmentStatus: "loading" as const },
      { departmentStatus: "error" as const },
      { departmentTenantId: 9 },
    ]) {
      const blocked = await submitFromPage(true, "8", editing, {
        visibility: "dept",
        departmentId: 3,
        departments: [{ id: 3, name: "Engineering" }],
        ...options,
      });
      assert.equal(blocked.calls.length, 0);
      assert.deepEqual(blocked.errors, ["departmentRequired"]);
      assert.equal(blocked.closed, false);
    }
  });
}

test("default-only editor ignores missing departments and only sends is_default", async () => {
  const result = await submitFromPage(false, "8", true, {
    defaultOnly: true,
    visibility: "dept",
  });
  assert.deepEqual(Object.keys(result.calls[0].payload), ["is_default"]);
});

test("department loading ignores stale responses and filters another tenant", async () => {
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
  let effect = "";
  function visit(node: import("typescript").Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes("/api/organization/depts")
    )
      effect = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect);
  const updates: {
    tenantId: number;
    items: { id: number }[];
    status: string;
  }[] = [];
  const pending: {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }[] = [];
  const context = {
    module: { exports: null as unknown },
    dialogOpen: true,
    formData: { visibility: "dept" },
    modelOwnerTenantId: 8,
    axios: {
      get(url: string) {
        assert.match(url, /^\/api\/organization\/depts\?tenant_id=(8|9)$/);
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      },
    },
    setDepartmentOptions(value: (typeof updates)[number]) {
      updates.push(value);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(`module.exports = ${effect}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    context
  );
  const load = context.module.exports as () => () => void;
  const cleanup = load();
  cleanup();
  context.modelOwnerTenantId = 9;
  load();
  pending[0].resolve({ data: { depts: [{ id: 1, tenant_id: 8 }] } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 2);
  pending[1].resolve({
    data: {
      depts: [
        { id: 2, tenant_id: 9 },
        { id: 3, tenant_id: 8 },
      ],
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.at(-1)?.status, "ready");
  assert.equal(updates.at(-1)?.tenantId, 9);
  const lastUpdate = updates.at(-1);
  assert.ok(lastUpdate);
  assert.deepEqual(
    Array.from(lastUpdate.items, (item) => item.id),
    [2]
  );
  load();
  pending[2].reject(new Error("unavailable"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.at(-1)?.status, "error");
});

test("other visibility modes omit department ownership from submission", async () => {
  for (const visibility of ["private", "tenant", "public"]) {
    const result = await submitFromPage(true, "8", false, {
      visibility,
      departmentId: 3,
    });
    assert.equal("owner_dept_id" in result.calls[0].payload, false);
  }
});
