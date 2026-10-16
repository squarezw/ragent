import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
const helpers: Record<string, (...args: unknown[]) => unknown> = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("lib/userCreditAllocation.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: helpers }
);
const { allocationAmount, allocationErrorKey, canAllocateUserCredits } = helpers;

test("allocation controls respect tenant boundaries and exclude department/ordinary roles", () => {
  assert.equal(canAllocateUserCredits({ isSuperAdmin: true }, { tenant_id: 9 }), true);
  assert.equal(
    canAllocateUserCredits({ isTenantAdmin: true, tenant_id: 9 }, { tenant_id: 9 }),
    true
  );
  assert.equal(
    canAllocateUserCredits({ isTenantAdmin: true, tenant_id: 8 }, { tenant_id: 9 }),
    false
  );
  assert.equal(canAllocateUserCredits({ tenant_id: 9 }, { tenant_id: 9 }), false);
  assert.equal(canAllocateUserCredits({ isSuperAdmin: true }, {}), false);
  assert.equal(canAllocateUserCredits(null, { tenant_id: 9 }), false);
});

test("allocation amount rejects excess balance, zero, negative and excess precision", () => {
  assert.equal(allocationAmount("1000", 10000), 1000);
  assert.equal(allocationAmount(" 0.01 ", 0.01), 0.01);
  assert.equal(allocationAmount("100.20", 100.2), 100.2);
  for (const value of ["", "0", "-1", "0.001", "1e3", "Infinity", "abc", "101"])
    assert.equal(allocationAmount(value, 100), null, value);
  assert.equal(allocationAmount("1", null), null);
  assert.equal(allocationAmount("1", -1), null);
});

test("business errors are localized and network failures remain uncertain", () => {
  assert.equal(
    allocationErrorKey({ response: { data: { detail: { code: "INSUFFICIENT_TENANT_BALANCE" } } } }),
    "creditInsufficientTenant"
  );
  assert.equal(
    allocationErrorKey({ response: { data: { detail: { code: "FORBIDDEN" } } } }),
    "creditForbidden"
  );
  assert.equal(allocationErrorKey({ response: { data: {} } }), "creditAllocationFailed");
  assert.equal(allocationErrorKey(new Error("network")), "creditAllocationUncertain");
});

async function lifecycle(
  method: "PUT" | "DELETE",
  opts: { blocked?: boolean; failWrite?: boolean; tenant?: number; superAdmin?: boolean } = {}
) {
  const queries: string[] = [];
  let released = false;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("prepare_user_credit_lifecycle") && opts.blocked)
        throw { code: "P0001", message: "USER_CREDIT_LIFECYCLE_BLOCKED" };
      if (opts.failWrite && sql.startsWith(method === "PUT" ? "UPDATE users" : "DELETE FROM users"))
        throw new Error("write failed");
      if (sql.startsWith("SELECT tenant_id"))
        return { rowCount: 1, rows: [{ tenant_id: 9, dept_id: null }] };
      if (sql.startsWith("UPDATE users") || sql.startsWith("DELETE FROM users"))
        return { rowCount: 1, rows: [{ id: 2 }] };
      return { rowCount: 0, rows: [] };
    },
    release() {
      released = true;
    },
  };
  const compiled = ts.transpileModule(
    readFileSync(`pages/api/user/${method === "PUT" ? "update" : "delete"}.ts`, "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }
  ).outputText;
  const exports = {} as { default: (req: unknown, res: unknown) => Promise<void> };
  vm.runInNewContext(compiled, {
    exports,
    console: { error() {} },
    require(name: string) {
      if (name === "@/lib/auth") return { getUserIdFromRequest: () => 1 };
      if (name === "@/lib/permissions")
        return {
          getUserPermissions: async () => ({ roles: [{ name: "超级管理员" }] }),
          isSuperAdmin: async () => opts.superAdmin !== false,
        };
      if (name === "@/lib/db") return { connect: async () => client, query: client.query };
      if (name === "bcryptjs") return {};
      throw new Error(name);
    },
  });
  const res = {
    statusCode: 200,
    body: null as Record<string, unknown> | null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body as Record<string, unknown>;
      return this;
    },
  };
  await exports.default(
    { method, body: method === "PUT" ? { id: 2, tenant_id: opts.tenant ?? 10 } : { id: 2 } },
    res
  );
  return { res, queries, released };
}

for (const method of ["PUT", "DELETE"] as const) {
  test(`${method}: nonzero or in-flight personal account blocks lifecycle and rolls back`, async () => {
    const { res, queries, released } = await lifecycle(method, { blocked: true });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.code, "USER_CREDIT_LIFECYCLE_BLOCKED");
    assert.ok(queries.includes("BEGIN") && queries.includes("ROLLBACK"));
    assert.ok(
      !queries.some((q) => q.startsWith(method === "PUT" ? "UPDATE users" : "DELETE FROM users"))
    );
    assert.equal(released, true);
  });
  test(`${method}: allowed lifecycle commits with the actual user write`, async () => {
    const { res, queries } = await lifecycle(method);
    assert.equal(res.statusCode, 200);
    assert.ok(queries.some((q) => q.includes("prepare_user_credit_lifecycle")));
    assert.ok(queries.includes("COMMIT"));
    assert.ok(!queries.includes("ROLLBACK"));
  });
  test(`${method}: a failed user write rolls back account archival`, async () => {
    const { res, queries } = await lifecycle(method, { failWrite: true });
    assert.equal(res.statusCode, 500);
    assert.ok(queries.includes("ROLLBACK"));
    assert.ok(!queries.includes("COMMIT"));
  });
}

test("saving the same tenant leaves the personal account intact", async () => {
  const { res, queries } = await lifecycle("PUT", { tenant: 9 });
  assert.equal(res.statusCode, 200);
  assert.ok(!queries.some((q) => q.includes("prepare_user_credit_lifecycle")));
});

test("a non-super administrator cannot delete or prepare a credit account", async () => {
  const { res, queries } = await lifecycle("DELETE", { superAdmin: false });
  assert.equal(res.statusCode, 403);
  assert.ok(!queries.includes("BEGIN"));
});
