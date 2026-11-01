import test from "node:test";
import assert from "node:assert/strict";
import { withAppTenantFence } from "../lib/appTenantFence.ts";
function fake(owner = 1) {
  const calls: string[] = [];
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      return { rows: sql.startsWith("SELECT owner") ? [{ owner_tenant_id: owner }] : [] };
    },
    release: () => calls.push("release"),
  };
  return { calls, pool: { connect: async () => client } };
}
test("shared fence and tenant reread precede writes on same transaction", async () => {
  const { calls, pool } = fake();
  await withAppTenantFence(pool, 9, 1, async (client) => {
    await client.query("INSERT fixture");
  });
  assert.deepEqual(calls, [
    "BEGIN",
    "SELECT pg_advisory_xact_lock_shared(72815, $1::integer)",
    "SELECT owner_tenant_id FROM apps WHERE id=$1",
    "INSERT fixture",
    "COMMIT",
    "release",
  ]);
});
test("post-transfer stale task cannot insert or enable; rollback and release", async () => {
  const { calls, pool } = fake(2);
  await assert.rejects(
    withAppTenantFence(pool, 9, 1, async (client) => {
      await client.query("INSERT fixture");
    }),
    /APP_TENANT_CHANGED/
  );
  assert.equal(
    calls.some((sql) => sql.startsWith("INSERT")),
    false
  );
  assert.deepEqual(calls.slice(-2), ["ROLLBACK", "release"]);
});
test("write failure rolls back, never commits", async () => {
  const { calls, pool } = fake();
  await assert.rejects(
    withAppTenantFence(pool, 9, 1, async () => {
      throw Error("fixture");
    }),
    /fixture/
  );
  assert.equal(calls.includes("COMMIT"), false);
  assert.deepEqual(calls.slice(-2), ["ROLLBACK", "release"]);
});
