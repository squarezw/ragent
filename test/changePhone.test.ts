import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("../pages/api/user/change-phone.ts", import.meta.url), "utf8");
async function change(
  body: any = { accessToken: "proof" },
  options: {
    auth?: boolean;
    identity?: boolean;
    occupied?: boolean;
    bindingConflict?: boolean;
    disabled?: boolean;
    missing?: boolean;
    pgError?: string;
    oldPhone?: string;
  } = {}
) {
  const calls: { sql: string; args: any[] }[] = [];
  const diagnostics: unknown[][] = [];
  let verified = false;
  let released = false;
  const client = {
    query: async (sql: string, args: any[] = []) => {
      calls.push({ sql, args: Array.from(args) });
      if (sql === "SELECT phone FROM users WHERE id=$1")
        return {
          rowCount: options.missing ? 0 : 1,
          rows: [{ phone: options.oldPhone || "13900139000" }],
        };
      if (sql.startsWith("SELECT id, status"))
        return { rowCount: 1, rows: [{ id: 7, status: options.disabled ? "disabled" : "active" }] };
      if (sql.startsWith("SELECT id FROM users"))
        return { rowCount: options.occupied ? 1 : 0, rows: [] };
      if (sql.startsWith("SELECT user_id FROM user_phone_identities"))
        return { rowCount: options.bindingConflict ? 1 : 0, rows: [] };
      if (sql.startsWith("UPDATE users") && options.pgError)
        throw Object.assign(new Error("private database details"), { code: options.pgError });
      return { rowCount: 1, rows: [] };
    },
    release: () => {
      released = true;
    },
  };
  const mocks: any = {
    "@/lib/db": { default: { connect: async () => client } },
    "@/lib/auth": { getUserIdFromRequest: () => (options.auth === false ? null : 7) },
    "@/lib/cloudbaseIdentity": {
      normalizePhone: (phone: string) => phone?.replace(/^\+86\s*/, ""),
      verifyCloudbasePhone: async () => {
        verified = true;
        if (options.identity === false) throw new Error("INVALID_CREDENTIALS");
        return { phone: "13800138000", uid: "new-uid", env: "env" };
      },
    },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      module,
      exports: module.exports,
      require: (name: string) => mocks[name],
      Error,
      Object,
      Set,
      console: { error: (...args: unknown[]) => diagnostics.push(args) },
    }
  );
  const response: any = {
    code: 200,
    body: null,
    setHeader: () => {},
    status(code: number) {
      this.code = code;
      return this;
    },
    json(value: any) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    },
  };
  await module.exports.default({ method: "POST", body }, response);
  return { response, calls, verified, released, diagnostics };
}
test("phone change requires authenticated current user and valid upstream phone proof", async () => {
  const anon = await change(undefined, { auth: false });
  assert.equal(anon.response.code, 401);
  assert.equal(anon.verified, false);
  assert.equal(anon.calls.length, 0);
  const bad = await change(undefined, { identity: false });
  assert.equal(bad.response.code, 401);
  assert.equal(bad.calls.length, 0);
});
test("phone change rejects target identifiers and client-declared phone even for valid sessions", async () => {
  for (const key of ["id", "userId", "user_id", "targetId", "targetUserId", "phone"]) {
    const r = await change({ accessToken: "proof", [key]: 123 });
    assert.equal(r.response.code, 400);
    assert.equal(r.verified, false);
    assert.equal(r.calls.length, 0);
  }
});
test("phone change updates only current user's verified phone and atomically replaces their mapping", async () => {
  const r = await change();
  assert.equal(r.response.code, 200);
  assert.equal(r.response.body.phone, "13800138000");
  const update = r.calls.find((c) => c.sql.startsWith("UPDATE users"))!;
  assert.deepEqual(update.args, ["13800138000", 7]);
  assert.doesNotMatch(update.sql, /password|tenant|username|dept|role/);
  const mapping = r.calls.find((c) => c.sql.startsWith("INSERT INTO user_phone_identities"))!;
  assert.deepEqual(mapping.args, [7, "env", "new-uid", "13800138000"]);
  assert.match(mapping.sql, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.ok(r.calls.some((c) => c.sql === "COMMIT"));
  assert.equal(r.released, true);
});
test("phone changes acquire stable canonical phone locks before users row lock", async () => {
  for (const oldPhone of ["13900139000", "+86 13700137000"]) {
    const { calls } = await change(undefined, { oldPhone });
    const lockIndex = calls.findIndex((c) => c.sql.includes("FOR UPDATE"));
    const phoneLocks = calls
      .slice(0, lockIndex)
      .filter((c) => c.sql.includes("pg_advisory") && !String(c.args[0]).startsWith("phone-user:"));
    assert.deepEqual(
      phoneLocks.map((c) => c.args[0]),
      ["13800138000", oldPhone.replace(/^\+86\s*/, "")].sort()
    );
    assert.ok(lockIndex > phoneLocks.length);
  }
});
test("occupied phone, including inactive owners, cannot be claimed", async () => {
  const r = await change(undefined, { occupied: true });
  assert.equal(r.response.code, 409);
  assert.equal(r.response.body.errorCode, "PHONE_ALREADY_REGISTERED");
  assert.ok(!r.calls.some((c) => c.sql.startsWith("INSERT") || c.sql.startsWith("UPDATE")));
  assert.ok(r.calls.some((c) => c.sql === "ROLLBACK"));
});
test("other user's phone or CloudBase UID binding cannot be overwritten", async () => {
  const r = await change(undefined, { bindingConflict: true });
  assert.equal(r.response.code, 409);
  assert.equal(r.response.body.errorCode, "PHONE_IDENTITY_CONFLICT");
  assert.ok(!r.calls.some((c) => c.sql.startsWith("INSERT") || c.sql.startsWith("UPDATE")));
  const check = r.calls.find((c) => c.sql.startsWith("SELECT user_id"))!;
  assert.match(check.sql, /user_id<>\$1/);
  assert.match(check.sql, /phone=\$2 OR \(environment=\$3 AND subject=\$4\)/);
});
test("missing or disabled current user is rejected without mutation", async () => {
  for (const options of [{ missing: true }, { disabled: true }]) {
    const r = await change(undefined, options);
    assert.equal(r.response.code, options.missing ? 404 : 403);
    assert.ok(!r.calls.some((c) => c.sql.startsWith("INSERT") || c.sql.startsWith("UPDATE")));
  }
});
test("unique races and later update failure roll back mapping and phone together", async () => {
  for (const pgError of ["23505", "XX000", "42P01"]) {
    const r = await change(undefined, { pgError });
    assert.ok(r.response.code >= 400);
    assert.ok(r.calls.some((c) => c.sql === "ROLLBACK"));
    assert.ok(!r.calls.some((c) => c.sql === "COMMIT"));
    assert.equal(r.response.body.details, undefined);
    assert.equal(r.released, true);
  }
});

test("database storage I/O failure has an explicit error and logs only safe stage metadata", async () => {
  const r = await change(undefined, { pgError: "58030" });
  assert.equal(r.response.code, 503);
  assert.equal(r.response.body.errorCode, "DB_STORAGE_UNAVAILABLE");
  assert.equal(r.response.body.failureStage, "update_phone");
  assert.ok(r.calls.some((c) => c.sql === "ROLLBACK"));
  assert.ok(!r.calls.some((c) => c.sql === "COMMIT"));
  assert.equal(r.response.body.phone, undefined);
  const log = JSON.stringify(r.diagnostics);
  assert.match(log, /58030/);
  assert.match(log, /update_phone/);
  assert.doesNotMatch(log, /13800138000|13900139000|proof|new-uid|private database details/);
});
