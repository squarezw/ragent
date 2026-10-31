import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("pages/api/user/update.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

async function update(
  body: Record<string, unknown>,
  options: {
    occupied?: boolean;
    emailOccupied?: boolean;
    dbError?: unknown;
    superAdmin?: boolean;
    tenantId?: number;
  } = {}
) {
  const queries: { sql: string; values?: unknown[] }[] = [];
  let released = false;
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values: values ? Array.from(values) : undefined });
      if (sql.includes("WHERE email="))
        return { rowCount: options.emailOccupied ? 1 : 0, rows: [] };
      if (sql.includes("WHERE phone=")) return { rowCount: options.occupied ? 1 : 0, rows: [] };
      if (sql.startsWith("UPDATE users")) {
        if (options.dbError) throw options.dbError;
        return { rowCount: 1, rows: [{ id: 1, phone: values?.[0] }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {
      released = true;
    },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, {
    exports,
    process: { env: {} },
    console: { error() {} },
    require(name: string) {
      if (name === "@/lib/auth") return { getUserIdFromRequest: () => 1 };
      if (name === "@/lib/permissions")
        return {
          getUserPermissions: async () => ({
            roles: [{ name: "普通用户" }],
            tenantId: options.tenantId,
          }),
          isSuperAdmin: async () => options.superAdmin || false,
        };
      if (name === "@/lib/db")
        return {
          connect: async () => client,
          query: async () => ({ rowCount: 1, rows: [{ tenant_id: 99 }] }),
        };
      if (name === "bcryptjs") return {};
      throw new Error(name);
    },
  });
  const response = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      this.body = value;
      return this;
    },
  };
  await exports.default({ method: "PUT", body }, response);
  return { response, queries, released };
}

test("general profile update rejects phone writes for ordinary users and all administrators", async () => {
  for (const superAdmin of [false, true]) {
    for (const phone of ["13800138000", "", null, 123, {}, []]) {
      const r = await update({ phone }, { superAdmin });
      assert.equal(r.response.statusCode, 400);
      assert.equal(r.response.body.code, "PHONE_VERIFICATION_REQUIRED");
      assert.equal(r.queries.length, 0);
    }
  }
});
test("administrators cannot change other users' phone through profile update", async () => {
  const r = await update({ id: 2, phone: "13800138000" }, { superAdmin: true });
  assert.equal(r.response.statusCode, 400);
  assert.equal(r.queries.length, 0);
});
test("omitted phone is preserved when editing ordinary profile fields", async () => {
  const r = await update({ nickname: "name" });
  assert.equal(r.response.statusCode, 200);
  const sql = r.queries.find((q) => q.sql.startsWith("UPDATE"))!.sql.split("RETURNING")[0];
  assert.doesNotMatch(sql, /phone/);
  assert.match(sql, /nickname/);
  assert.equal(r.released, true);
});
test("ordinary and cross-tenant users remain unable to edit another user's profile", async () => {
  for (const options of [{}, { tenantId: 2 }]) {
    const r = await update({ id: 2, nickname: "new" }, options);
    assert.equal(r.response.statusCode, 403);
    assert.equal(r.queries.length, 0);
  }
});
test("email conflict remains distinct and does not write", async () => {
  const r = await update({ email: "used@example.com" }, { emailOccupied: true });
  assert.equal(r.response.statusCode, 409);
  assert.equal(r.response.body.code, "EMAIL_ALREADY_REGISTERED");
  assert.ok(!r.queries.some((q) => q.sql.startsWith("UPDATE")));
});
