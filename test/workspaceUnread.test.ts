import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import ts from "typescript";
function compile(path: string, dependencies: (name: string) => any) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: dependencies,
    Buffer,
    process: { env: { AUTOMATION_MAILBOX_SECRET: "test-only-placeholder" } },
  });
  return module.exports;
}
function harness(tenant: number | null) {
  let queries: string[] = [];
  let connections = 0;
  const workspace = compile("lib/automation/workspace.ts", (name) => {
    if (name === "node:async_hooks") return { AsyncLocalStorage };
    if (name === "@/lib/workspaceTenant") return { workspaceEnabled: () => true };
    throw Error(name);
  });
  const mailboxes = compile("lib/automation/mailboxes.ts", (name) => {
    if (name === "@/lib/automation/workspace") return workspace;
    if (name === "@/lib/db")
      return {
        query: async (sql: string, params: any[]) => {
          queries.push(sql);
          assert.deepEqual(Array.from(params), [5, 2]);
          return { rows: sql.includes("tenant_id = 6") ? [{ id: 5, tenant_id: 6 }] : [] };
        },
      };
    if (name === "@/lib/automation/schema") return { assertAutomationTablesReady: async () => {} };
    if (name === "@/lib/automation/mailbox-credentials")
      return { decryptMailboxPassword: () => "test-placeholder" };
    return {};
  });
  const route = compile("pages/api/v1/email/unread-config.ts", (name) => {
    if (name === "@/lib/workspaceTenant")
      return {
        requireWorkspaceTenant: async (_req: any, res: any) => {
          if (tenant === null) {
            res.status(409).json({});
            return null;
          }
          return { enabled: true, tenantId: tenant, actorUserId: 2 };
        },
      };
    if (name === "@/lib/automation/workspace") return workspace;
    if (name === "@/lib/auth") return { getUserIdFromRequest: () => 2 };
    if (name === "@/lib/automation/mailboxes") return mailboxes;
    if (name === "@/lib/automation/imap-client")
      return {
        fetchMailboxUnread: async () => {
          connections++;
          return { success: true };
        },
      };
    if (name === "@/lib/automation/mailbox-errors")
      return {
        respondMailboxApiError: (_res: any, error: unknown) => {
          throw error;
        },
      };
    throw Error(name);
  });
  const res: any = {
    code: 200,
    status(n: number) {
      this.code = n;
      return this;
    },
    json(value: any) {
      this.data = value;
      return this;
    },
    setHeader() {},
  };
  return { route, res, queries, connections: () => connections };
}
test("unread mailbox route applies actual actor and tenant SQL before any IMAP connection", async () => {
  for (const tenant of [6, 7, null]) {
    const h = harness(tenant);
    await h.route.default(
      { method: "POST", body: { mailboxId: 5 }, headers: {}, query: {} },
      h.res
    );
    assert.equal(h.res.code, tenant === 6 ? 200 : tenant === 7 ? 404 : 409);
    assert.equal(h.connections(), tenant === 6 ? 1 : 0);
    if (tenant !== null) {
      assert.ok(h.queries[0].includes("created_by_user_id=$2"));
      assert.ok(h.queries[0].includes(`tenant_id = ${tenant}`));
    } else assert.equal(h.queries.length, 0);
  }
});
