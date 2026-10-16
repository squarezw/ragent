import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("../pages/api/user/login.ts", import.meta.url), "utf8");
async function login(rows: any[], match = true) {
  const module = { exports: {} as any };
  let signed = false;
  const mocks: any = {
    bcryptjs: { default: { compare: async () => match } },
    jsonwebtoken: {
      default: {
        sign: () => {
          signed = true;
          return "token";
        },
      },
    },
    "@/lib/db": { default: { query: async () => ({ rowCount: rows.length, rows }) } },
    "@/lib/auth": { setAuthCookie: () => {} },
    "@/lib/env": { requireEnv: () => "secret" },
  };
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, process, require: (name: string) => mocks[name] }
  );
  const res: any = {
    code: 200,
    body: null,
    status(code: number) {
      this.code = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
  await module.exports.default(
    { method: "POST", body: { username: "alice", password: "password" } },
    res
  );
  return { res, signed };
}
test("password login rejects ambiguous username/phone matches", async () => {
  const { res, signed } = await login([{ id: 1 }, { id: 2 }]);
  assert.equal(res.code, 401);
  assert.equal(signed, false);
});
test("password login rejects inactive account before issuing token", async () => {
  const { res, signed } = await login([{ id: 1, status: "disabled" }]);
  assert.equal(res.code, 403);
  assert.equal(signed, false);
});
test("pending ordinary account can log in without returning password", async () => {
  const { res, signed } = await login([
    { id: 1, status: "active", password: "hashed", tenant_id: null },
  ]);
  assert.equal(res.code, 200);
  assert.equal(signed, true);
  assert.equal(res.body.user.tenant_id, null);
  assert.equal(res.body.user.password, undefined);
});
test("bad password does not issue token", async () => {
  const { res, signed } = await login([{ id: 1, status: "active" }], false);
  assert.equal(res.code, 401);
  assert.equal(signed, false);
});
