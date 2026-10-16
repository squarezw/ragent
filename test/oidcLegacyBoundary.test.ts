import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
test("OIDC enabled disables legacy password/phone authentication and public registration writes", async () => {
  for (const file of ["login.ts", "phone.ts", "register.ts"]) {
    const module = { exports: {} as any };
    let status = 0,
      body: any;
    const res: any = {
      setHeader: () => {},
      status: (s: number) => {
        status = s;
        return res;
      },
      json: (value: any) => (body = value),
      end: () => {},
    };
    vm.runInNewContext(
      ts.transpileModule(
        readFileSync(new URL("../pages/api/user/" + file, import.meta.url), "utf8"),
        { compilerOptions: { module: ts.ModuleKind.CommonJS } }
      ).outputText,
      {
        module,
        exports: module.exports,
        require: () => ({}),
        process: { env: { OIDC_ENABLED: "true" } },
        Buffer,
      }
    );
    await module.exports.default(
      {
        method: "POST",
        body: {
          username: "alice",
          password: "untrusted",
          mode: "register",
          accessToken: "untrusted",
        },
      },
      res
    );
    assert.equal(status, 410, file);
    assert.equal(body.errorCode, "UNIFIED_IDENTITY_REQUIRED", file);
  }
});
