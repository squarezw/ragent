import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
// @ts-expect-error Node strip-types requires the explicit TypeScript extension.
import { PENDING_TENANT_SQL } from "../lib/pendingTenant.ts";

async function invoke(
  file: string,
  options: {
    userId?: number;
    superAdmin?: boolean;
    method?: string;
    tier?: string;
    fail?: boolean;
  } = {}
) {
  const queries: string[] = [];
  const query = async (sql: string) => {
    queries.push(sql);
    if (options.fail) throw new Error("database unavailable");
    return { rows: [{ count: 3 }] };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const imports: Record<string, unknown> = {
    "@/lib/auth": { getUserIdFromRequest: () => options.userId },
    "@/lib/db": { default: pool },
    "@/lib/permissions": { isSuperAdmin: async () => options.superAdmin },
    "@/lib/pendingTenant": { PENDING_TENANT_SQL },
    "@/lib/visibilityScope": {
      buildVisibilityScope: async () => ({
        tier: options.tier ?? "super",
        conditions: [],
        params: [],
        nextIndex: 1,
      }),
    },
  };
  const source = readFileSync(new URL(`../pages/api/user/${file}.ts`, import.meta.url), "utf8");
  const exports: Record<string, any> = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in imports, name);
        return imports[name];
      },
      console: { error() {} },
    }
  );
  let status = 200;
  let body: any;
  const res = {
    setHeader() {},
    status(code: number) {
      status = code;
      return res;
    },
    json(value: unknown) {
      body = value;
      return res;
    },
  };
  await exports.default({ method: options.method ?? "GET", query: {} }, res);
  return { status, body, queries };
}

test("pending count rejects anonymous and non-platform administrators without querying users", async () => {
  for (const [options, expected] of [
    [{}, 401],
    [{ userId: 1, superAdmin: false }, 403],
    [{ method: "POST" }, 405],
  ] as const) {
    const result = await invoke("pending-tenant-count", options);
    assert.equal(result.status, expected);
    assert.equal(result.queries.length, 0);
  }
});

test("count uses the shared predicate and reports query failure instead of zero", async () => {
  const result = await invoke("pending-tenant-count", { userId: 1, superAdmin: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.count, 3);
  assert.ok(result.queries[0].includes(PENDING_TENANT_SQL));
  const failed = await invoke("pending-tenant-count", { userId: 1, superAdmin: true, fail: true });
  assert.equal(failed.status, 500);
  assert.equal(failed.body.count, undefined);
});

test("list prioritizes the same pending population only for platform administrators", async () => {
  const admin = await invoke("list", { userId: 1 });
  assert.ok(admin.queries[0].includes(PENDING_TENANT_SQL));
  assert.match(admin.queries[0], /ORDER BY pending_tenant DESC, u.id ASC/);
  const tenantAdmin = await invoke("list", { userId: 1, tier: "tenant" });
  assert.match(tenantAdmin.queries[0], /false AS pending_tenant/);
  assert.match(tenantAdmin.queries[0], /ORDER BY\s+u.id ASC/);
});
