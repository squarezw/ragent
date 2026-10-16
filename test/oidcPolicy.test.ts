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

test("local HTTP requires explicit development opt-in and stays forbidden in production or remote hosts", () => {
  const env = {
    OIDC_ENABLED: "true",
    NODE_ENV: "development",
    OIDC_ALLOW_INSECURE_LOCAL_HTTP: "true",
    OIDC_ISSUER: "http://127.0.0.1:8021",
    OIDC_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/oidc/callback",
    OIDC_CLIENT_ID: "local-ragent",
    OIDC_CLIENT_SECRET: "local-fixture-secret-01234567890123456789",
    OIDC_TRANSACTION_KEY: "a".repeat(64),
  };
  assert.equal(readOidcSettings(env).testHttp, true);
  assert.throws(() => readOidcSettings({ ...env, OIDC_ALLOW_INSECURE_LOCAL_HTTP: "false" }));
  assert.throws(() => readOidcSettings({ ...env, NODE_ENV: "production" }));
  assert.throws(() => readOidcSettings({ ...env, OIDC_ISSUER: "http://192.168.1.2:8021" }));
  assert.throws(() =>
    readOidcSettings({ ...env, OIDC_REDIRECT_URI: "http://evil.example/api/auth/oidc/callback" })
  );
  assert.equal(
    readOidcSettings({
      ...env,
      NODE_ENV: "test",
      OIDC_ALLOW_INSECURE_TEST_HTTP: "true",
      OIDC_ALLOW_INSECURE_LOCAL_HTTP: "false",
    }).testHttp,
    true
  );
});
