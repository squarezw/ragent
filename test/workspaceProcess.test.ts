import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture(options: { company?: string; mapped?: boolean; enabled?: boolean } = {}) {
  const calls: any[] = [];
  const ctx = {
    enabled: options.enabled !== false,
    tenantId: 10,
    actorUserId: 7,
    isSuperAdmin: true,
  };
  const exports: any = {};
  const imports: Record<string, any> = {
    axios: {
      default: {
        get: async (url: string) => ({
          data: {
            data: url.includes("process-documents")
              ? { node_id: "node" }
              : { company_code: options.company || "A" },
          },
        }),
      },
    },
    "./db": {
      default: {
        query: async (sql: string, args: any[]) => {
          calls.push({ sql, args });
          return {
            rows: options.mapped === false ? [] : [{ created_by: 7, external_id: args[0] }],
          };
        },
      },
    },
    "./workspaceTenant": { requireWorkspaceTenant: async () => ctx },
    "./tenantMapping": {
      getCompanyCodeByTenantId: (id: number) => {
        assert.equal(id, 10);
        return "A";
      },
    },
  };
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../lib/workspaceProcess.ts", import.meta.url), "utf8"),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }
    ).outputText,
    {
      exports,
      process: { env: { WORKSPACE_TENANT_ENABLED: "true" } },
      Buffer,
      require: (id: string) => {
        assert.ok(id in imports, id);
        return imports[id];
      },
    }
  );
  let status = 200;
  let body: any;
  let reached = 0;
  const res: any = {
    headersSent: false,
    status(n: number) {
      status = n;
      return res;
    },
    json(value: any) {
      body = value;
      return res;
    },
  };
  const run = exports.withProcessWorkspace(async () => {
    reached++;
  });
  return {
    run,
    exports,
    res,
    ctx,
    calls,
    status: () => status,
    body: () => body,
    reached: () => reached,
  };
}

test("external document belongs to fixed company/node chain before original permissions run", async () => {
  const f = fixture();
  const req: { url: string; query: { id: string }; body: Record<string, unknown> } = {
    url: "/api/v1/process-management/process-documents/doc",
    query: { id: "doc" },
    body: {},
  };
  await f.run(req, f.res);
  assert.equal(f.reached(), 1);
  assert.equal(req.body.company_code, "A");
  const other = fixture({ company: "B" });
  await other.run({ url: req.url, query: { id: "doc" }, body: {} }, other.res);
  assert.equal(other.status(), 404);
  assert.equal(other.reached(), 0);
});
test("unmapped legacy session is quarantined for both snake/camel query names", async () => {
  for (const query of [{ sessionId: "old" }, { session_id: "old" }]) {
    const f = fixture({ mapped: false });
    await f.run({ url: "/api/v1/process-management/handbook/convert", query, body: {} }, f.res);
    assert.equal(f.status(), 404);
    assert.equal(f.reached(), 0);
    assert.deepEqual(Array.from(f.calls[0].args), ["old", 10]);
  }
});
test("creation binds exact external ID to operation tenant and immutable real creator", async () => {
  const f = fixture();
  assert.equal(await f.exports.bindProcessWorkspaceSession({}, f.res, { session_id: "new" }), true);
  assert.deepEqual(Array.from(f.calls[0].args), ["new", 10, 7]);
  assert.match(f.calls[0].sql, /operation_tenant_id=EXCLUDED.operation_tenant_id/);
});
test("missing create protocol ID fails visibly; default-off preserves the old handler", async () => {
  const f = fixture();
  assert.equal(await f.exports.bindProcessWorkspaceSession({}, f.res, {}), false);
  assert.equal(f.status(), 502);
  const off = fixture({ enabled: false });
  await off.run({ url: "/old", query: {}, body: {} }, off.res);
  assert.equal(off.reached(), 1);
  assert.equal(off.calls.length, 0);
});

test("copying into a tenant document validates the source session and source knowledge file", async () => {
  for (const query of [{ id: "doc", from_session: "foreign" }, { id: "doc", from_knowledge_file: "42" }]) {
    const f = fixture({ mapped: false });
    await f.run({ url: "/api/v1/process-management/process-documents/doc/file", query, body: {} }, f.res);
    assert.equal(f.status(), 404);
    assert.equal(f.reached(), 0);
    assert.match(f.calls[0].sql, query.from_session ? /operation_tenant_id=\$2/ : /d.owner_tenant_id=\$2/);
  }
});
