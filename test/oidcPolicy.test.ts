import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const module = { exports: {} as any };
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/oidcPolicy.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { module, exports: module.exports, require, Buffer, URL, process, Date }
);
const { safeReturnTo, sealTransaction, openTransaction, localSessionTtl, readOidcSettings } =
  module.exports;
const key = "a".repeat(64);
test("OIDC defaults off; incomplete or insecure enabled configuration fails closed", () => {
  assert.equal(readOidcSettings({}), null);
  assert.throws(() => readOidcSettings({ OIDC_ENABLED: "true" }));
  assert.throws(() =>
    readOidcSettings({ OIDC_ENABLED: "true", OIDC_ISSUER: "http://example.com" })
  );
});
test("returnTo accepts local paths and rejects cross-origin, encoded slashes and auth loops", () => {
  assert.equal(safeReturnTo("/chat?x=1"), "/chat?x=1");
  for (const value of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/%2fevil.test",
    "/api/auth/oidc/start",
    "/identity-login",
    "/ok\nLocation:evil",
  ])
    assert.equal(safeReturnTo(value), "/");
});
test("encrypted transaction binds state nonce PKCE return path and expires in five minutes", () => {
  const payload = {
    state: "state",
    nonce: "nonce",
    verifier: "pkce-verifier",
    returnTo: "/chat",
    createdAt: 1000,
  };
  const cookie = sealTransaction(payload, key);
  assert.ok(!cookie.includes("pkce-verifier"));
  assert.equal(JSON.stringify(openTransaction(cookie, key, 1010)), JSON.stringify(payload));
  assert.throws(() => openTransaction(cookie, key, 1301));
  assert.throws(() => openTransaction(cookie, key, 999));
  assert.throws(() => openTransaction(cookie.slice(0, -2) + "aa", key, 1010));
  assert.throws(() => openTransaction(cookie, "b".repeat(64), 1010));
});
test("local session cannot outlive verified ID token, token lifetime or local maximum", () => {
  assert.equal(localSessionTtl({ exp: 1300 }, 500, 1000), 300);
  assert.equal(localSessionTtl({ exp: 1500 }, 90, 1000), 90);
  assert.equal(localSessionTtl({ exp: 999999 }, 999999, 1000), 3600);
  assert.throws(() => localSessionTtl({ exp: 999 }, 500, 1000));
  assert.throws(() => localSessionTtl({}, 500, 1000));
});
