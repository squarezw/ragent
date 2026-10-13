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

test("phone trims input, accepts international formats, and excludes self globally", async () => {
  const result = await update({ phone: "  +44 123 456  " });
  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.queries[0], {
    sql: "SELECT 1 FROM users WHERE phone=$1 AND id<>$2",
    values: ["+44 123 456", 1],
  });
  assert.equal(result.queries.find((q) => q.sql.startsWith("UPDATE"))?.values?.[0], "+44 123 456");
  assert.equal(result.released, true);
});

test("empty or null clears phone; omission preserves it", async () => {
  for (const phone of ["", "   ", null]) {
    const result = await update({ phone });
    const query = result.queries.find((q) => q.sql.startsWith("UPDATE"));
    assert.match(query!.sql, /phone = \$1/);
    assert.equal(query!.values![0], null);
  }
  const result = await update({ nickname: "name" });
  assert.doesNotMatch(
    result.queries.find((q) => q.sql.startsWith("UPDATE"))!.sql.split("RETURNING")[0],
    /phone/
  );
});

test("invalid phone types are rejected without a write", async () => {
  for (const phone of [123, false, [], {}]) {
    const result = await update({ phone });
    assert.equal(result.response.statusCode, 400);
    assert.equal(result.queries.length, 0);
  }
});

test("existing number and concurrent unique violation report phone conflict", async () => {
  for (const options of [
    { occupied: true },
    { dbError: { code: "23505", constraint: "users_phone_unique" } },
  ]) {
    const result = await update({ phone: "123" }, options);
    assert.equal(result.response.statusCode, 409);
    assert.equal(result.response.body.code, "PHONE_ALREADY_REGISTERED");
    assert.equal(result.response.body.error, "手机号已注册");
    assert.equal(result.released, true);
  }
});

test("unrelated unique violations and database failures are not phone conflicts", async () => {
  for (const dbError of [{ code: "23505", constraint: "users_email_key" }, { code: "42P01" }]) {
    const result = await update({ phone: "123" }, { dbError });
    assert.equal(result.response.statusCode, 500);
    assert.notEqual(result.response.body.code, "PHONE_ALREADY_REGISTERED");
  }
});

test("ordinary user cannot change another user; cross-tenant update stays denied", async () => {
  for (const options of [{}, { tenantId: 2 }]) {
    const result = await update({ id: 2, phone: "123" }, options);
    assert.equal(result.response.statusCode, 403);
    assert.equal(result.queries.length, 0);
  }
});

test("super admin self-update supports phone", async () => {
  const result = await update({ phone: "123" }, { superAdmin: true });
  assert.equal(result.response.statusCode, 200);
  assert.match(result.queries.find((q) => q.sql.startsWith("UPDATE"))!.sql, /phone =/);
});

test("email conflict stays distinguishable from phone conflict", async () => {
  const result = await update({ email: "used@example.com", phone: "123" }, { emailOccupied: true });
  assert.equal(result.response.statusCode, 409);
  assert.equal(result.response.body.code, "EMAIL_ALREADY_REGISTERED");
  assert.equal(
    result.queries.some((q) => q.sql.startsWith("UPDATE")),
    false
  );
});
