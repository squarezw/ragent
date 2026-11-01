import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { lockAppTenant, withAppTenantFence } from "../lib/appTenantFence.ts";
const source = readFileSync(new URL("../lib/automation/store.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true);
const functions = ast.statements
  .filter(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      ["createAutomation", "updateAutomation", "insertRunRow", "createRun"].includes(
        node.name?.text || ""
      )
  )
  .map((node) => node.getText(ast))
  .join("\n");
function fixture(owner = 1) {
  const calls: string[] = [];
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      return { rows: sql.startsWith("SELECT owner") ? [{ owner_tenant_id: owner }] : [{ id: 8 }] };
    },
    release: () => calls.push("release"),
  };
  const pool = { connect: async () => client };
  const module = { exports: {} as any };
  vm.runInNewContext(
    ts.transpileModule(functions, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      module,
      exports: module.exports,
      lockAppTenant,
      withAppTenantFence,
      pool,
      assertAutomationTablesReady: async () => {},
      automationWorkspaceTenant: () => 1,
      getUserTenantId: async () => 1,
      resolveAppName: async () => "app",
      getAutomation: async () => ({
        id: 8,
        tenant_id: 1,
        app_id: 9,
        name: "task",
        task: "prompt",
        trigger_type: "Webhook / API",
        strategy: "仅生成结果",
        status: "running",
        trigger_config: {},
        result_config: {},
      }),
      automationTenantClause: () => "",
      normalizeEmailRules: () => [],
    }
  );
  return { calls, store: module.exports };
}
for (const operation of ["createAutomation", "updateAutomation", "createRun"])
  test(`actual ${operation} locks, rereads tenant and writes same transaction`, async () => {
    const h = fixture();
    if (operation === "createRun") await h.store.createRun({ app_id: 9, tenant_id: 1 }, "running");
    else if (operation === "createAutomation")
      await h.store.createAutomation(7, {
        appId: 9,
        name: "test",
        task: "test",
        trigger: "Webhook / API",
      });
    else await h.store.updateAutomation(7, 8, {});
    const lock = h.calls.findIndex((sql) => sql.includes("advisory"));
    const read = h.calls.findIndex((sql) => sql.startsWith("SELECT owner"));
    const write = h.calls.findIndex((sql) =>
      /INSERT INTO automation|UPDATE automation_tasks/.test(sql)
    );
    assert.ok(lock > 0 && read > lock && write > read);
    assert.equal(h.calls[0], "BEGIN");
    assert.deepEqual(h.calls.slice(-2), ["COMMIT", "release"]);
  });
test("actual old tenant scheduled/run snapshot is refused after transfer", async () => {
  const h = fixture(2);
  await assert.rejects(
    h.store.createRun({ app_id: 9, tenant_id: 1 }, "running"),
    /APP_TENANT_CHANGED/
  );
  assert.equal(
    h.calls.some((sql) => sql.includes("INSERT INTO")),
    false
  );
  assert.deepEqual(h.calls.slice(-2), ["ROLLBACK", "release"]);
});
