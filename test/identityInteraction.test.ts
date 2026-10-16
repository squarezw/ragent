import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const module = { exports: {} as any };
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../lib/identityInteraction.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText,
  {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    window: { location: { origin: "https://issuer.example" } },
  }
);
const { interactionPath, submitIdentityInteraction } = module.exports;
test("central interaction sends raw password URL-encoded with CSRF; no machine credentials/token login storage", async () => {
  const calls: any[] = [];
  const fake = async (path: string, options: any) => {
    calls.push({ path, options });
    return { ok: true, json: async () => ({ redirectTo: "/auth/return/opaque" }) };
  };
  const redirect = await submitIdentityInteraction(
    "opaque-uid",
    "csrf",
    { username: "alice", password: "p+&word" },
    false,
    fake
  );
  assert.equal(redirect, "/auth/return/opaque");
  assert.equal(calls[0].path, "/interaction/opaque-uid");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.match(calls[0].options.headers["Content-Type"], /urlencoded/);
  const form = new URLSearchParams(calls[0].options.body);
  assert.equal(form.get("password"), "p+&word");
  assert.equal(form.get("csrf"), "csrf");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.headers.Authorization, undefined);
});
test("registration uses same interaction identity and verified phone token", async () => {
  let path = "";
  await submitIdentityInteraction(
    "uid",
    "csrf",
    { username: "alice", password: "pass", access_token: "verified" },
    true,
    async (p: string) => {
      path = p;
      return { ok: true, json: async () => ({ redirectTo: "/auth/resume" }) };
    }
  );
  assert.equal(path, "/interaction/uid/register");
  const absolute = await submitIdentityInteraction("uid", "csrf", {}, false, async () => ({
    ok: true,
    json: async () => ({ redirectTo: "https://issuer.example/auth/resume" }),
  }));
  assert.equal(absolute, "/auth/resume");
  assert.throws(() => interactionPath("../bad"));
  await assert.rejects(() =>
    submitIdentityInteraction("uid", "csrf", {}, false, async () => ({
      ok: true,
      json: async () => ({ redirectTo: "https://evil.test" }),
    }))
  );
});
