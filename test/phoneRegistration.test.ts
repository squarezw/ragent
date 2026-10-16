import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("../pages/api/user/phone.ts", import.meta.url), "utf8");
async function invoke(
  body: any,
  options: {
    identity?: boolean;
    existing?: boolean;
    mapped?: boolean;
    disabled?: boolean;
    legacyCount?: number;
    mappingConflict?: boolean;
    missingSchema?: boolean;
    uniqueViolation?: boolean;
  } = {}
) {
  const calls: any[] = [];
  const releases: any[] = [];
  const query = async (sql: string, args: any[]) => {
    calls.push({ sql, args });
    if (sql.startsWith("INSERT INTO user_phone_identities") && options.uniqueViolation)
      throw Object.assign(new Error("unique constraint"), { code: "23505" });
    if (sql.startsWith("SELECT u.*") && options.missingSchema)
      throw Object.assign(new Error("missing relation"), { code: "42P01" });
    if (sql.startsWith("SELECT id, status FROM users"))
      return {
        rowCount: options.legacyCount || 0,
        rows: Array.from({ length: options.legacyCount || 0 }, (_, i) => ({
          id: 7 + i,
          status: options.disabled ? "disabled" : "active",
        })),
      };
    if (sql.startsWith("SELECT user_id FROM user_phone_identities"))
      return {
        rowCount: options.mappingConflict ? 1 : 0,
        rows: options.mappingConflict ? [{ user_id: 7 }] : [],
      };
    if (sql.startsWith("SELECT u.*"))
      return {
        rowCount: options.mapped ? 1 : 0,
        rows: options.mapped ? [{ id: 7, status: options.disabled ? "disabled" : "active" }] : [],
      };
    if (sql.startsWith("SELECT id FROM users"))
      return { rowCount: options.existing ? 1 : 0, rows: [] };
    if (sql.startsWith("INSERT INTO users"))
      return { rowCount: 1, rows: [{ id: 7, status: "active" }] };
    return { rowCount: 0, rows: [] };
  };
  const mocks: any = {
    "@/lib/db": {
      default: { connect: async () => ({ query, release: () => releases.push(true) }) },
    },
    "@/lib/auth": { setAuthCookie: () => {} },
    "@/lib/env": { requireEnv: () => "test-secret" },
    bcryptjs: { default: { hash: async () => "hashed-password" } },
    jsonwebtoken: { default: { sign: () => "ragent-token" } },
    "@/lib/cloudbaseIdentity": {
      verifyCloudbasePhone: async () => {
        if (options.identity === false) throw Error("INVALID_CREDENTIALS");
        return { phone: "13800138000", uid: "cloud-uid", env: "test-env" };
      },
    },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      module,
      process: { env: { OIDC_ENABLED: "false" } },
      exports: module.exports,
      require: (name: string) => mocks[name],
      Buffer,
      console,
      Error,
    }
  );
  const res: any = {
    code: 200,
    body: null,
    setHeader: () => {},
    status(n: number) {
      this.code = n;
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
  await module.exports.default({ method: "POST", body }, res);
  return { res, calls, releases };
}
test("verified registration stores chosen username and hashed password with no tenant", async () => {
  const { res, calls, releases } = await invoke({
    mode: "register",
    username: "alice",
    password: "secure-password",
    accessToken: "verified",
  });
  assert.equal(res.code, 201);
  assert.equal(res.body.token, "ragent-token");
  const insert = calls.find((c) => c.sql.startsWith("INSERT INTO users"));
  assert.deepEqual(Array.from(insert.args), ["alice", "hashed-password", "13800138000"]);
  assert.match(insert.sql, /NULL,NULL,NULL,'active'/);
  assert.ok(calls.some((c) => c.sql === "COMMIT"));
  assert.equal(releases.length, 1);
});
test("missing or invalid username cannot create account", async () => {
  for (const username of [undefined, "a", "contains space", "x".repeat(33)]) {
    const { res, calls } = await invoke({
      mode: "register",
      username,
      password: "secure-password",
    });
    assert.equal(res.code, 400);
    assert.equal(calls.length, 0);
  }
});
test("phone validation step creates no local account", async () => {
  const { res, calls } = await invoke({ mode: "verify", accessToken: "verified" });
  assert.equal(res.body.verified, true);
  assert.equal(calls.length, 0);
});
test("invalid cloud credential cannot reach database", async () => {
  const { res, calls } = await invoke({ mode: "login", accessToken: "fake" }, { identity: false });
  assert.equal(res.code, 403);
  assert.equal(calls.length, 0);
});
test("existing legacy phone or username is rejected without password overwrite", async () => {
  const { res, calls } = await invoke(
    { mode: "register", username: "alice", password: "secure-password" },
    { existing: true }
  );
  assert.equal(res.code, 409);
  assert.ok(!calls.some((c) => c.sql.startsWith("INSERT")));
  assert.ok(calls.some((c) => c.sql === "ROLLBACK"));
});
test("SMS login requires a registered active account", async () => {
  assert.equal((await invoke({ mode: "login" })).res.body.errorCode, "PHONE_NOT_REGISTERED");
  assert.equal(
    (await invoke({ mode: "login" }, { mapped: true, disabled: true })).res.body.errorCode,
    "ACCOUNT_DISABLED"
  );
  assert.equal((await invoke({ mode: "login" }, { mapped: true })).res.body.token, "ragent-token");
});
test("password bounds enforce bcrypt byte limit", async () => {
  for (const password of ["short", "密".repeat(25)]) {
    const { res, calls } = await invoke({ mode: "register", username: "alice", password });
    assert.equal(res.code, 400);
    assert.equal(calls.length, 0);
  }
});

test("six-character registration password accepted, five rejected", async () => {
  assert.equal(
    (await invoke({ mode: "register", username: "alice", password: "123456" })).res.code,
    201
  );
  assert.equal(
    (await invoke({ mode: "register", username: "alice", password: "12345" })).res.code,
    400
  );
});
test("verified unique active legacy phone binds then logs in without changing account", async () => {
  const { res, calls } = await invoke({ mode: "login" }, { legacyCount: 1 });
  assert.equal(res.code, 200);
  assert.equal(res.body.token, "ragent-token");
  const binding = calls.find((c) => c.sql.startsWith("INSERT INTO user_phone_identities"));
  assert.deepEqual(Array.from(binding.args), [7, "test-env", "cloud-uid", "13800138000"]);
  assert.ok(
    !calls.some(
      (c) =>
        c.sql.startsWith("UPDATE") ||
        c.sql.startsWith("INSERT INTO users") ||
        c.sql.startsWith("INSERT INTO user_roles")
    )
  );
});
test("ambiguous legacy phone does not bind or log in", async () => {
  const { res, calls } = await invoke({ mode: "login" }, { legacyCount: 2 });
  assert.equal(res.body.errorCode, "PHONE_ACCOUNT_AMBIGUOUS");
  assert.ok(!calls.some((c) => c.sql.startsWith("INSERT")));
});
test("legacy account with another UID, environment or phone binding fails closed", async () => {
  const { res, calls } = await invoke({ mode: "login" }, { legacyCount: 1, mappingConflict: true });
  assert.equal(res.body.errorCode, "PHONE_IDENTITY_CONFLICT");
  assert.ok(!calls.some((c) => c.sql.startsWith("INSERT")));
});
test("disabled legacy phone does not bind", async () => {
  const { res, calls } = await invoke({ mode: "login" }, { legacyCount: 1, disabled: true });
  assert.equal(res.body.errorCode, "ACCOUNT_DISABLED");
  assert.ok(!calls.some((c) => c.sql.startsWith("INSERT")));
});
test("missing migration is reported distinctly without leaking database details", async () => {
  const { res } = await invoke({ mode: "login" }, { missingSchema: true });
  assert.equal(res.code, 503);
  assert.equal(res.body.errorCode, "AUTH_SCHEMA_NOT_READY");
  assert.equal(res.body.details, undefined);
});

test("identity unique races roll back and do not issue a session", async () => {
  const login = await invoke({ mode: "login" }, { legacyCount: 1, uniqueViolation: true });
  assert.equal(login.res.code, 403);
  assert.equal(login.res.body.errorCode, "PHONE_IDENTITY_CONFLICT");
  assert.equal(login.res.body.token, undefined);
  assert.ok(login.calls.some((c) => c.sql === "ROLLBACK"));
  assert.ok(!login.calls.some((c) => c.sql === "COMMIT"));
  const registration = await invoke(
    { mode: "register", username: "alice", password: "123456" },
    { uniqueViolation: true }
  );
  assert.equal(registration.res.code, 409);
  assert.equal(registration.res.body.token, undefined);
  assert.ok(registration.calls.some((c) => c.sql === "ROLLBACK"));
  assert.ok(!registration.calls.some((c) => c.sql === "COMMIT"));
});
