import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import * as openid from "openid-client";
const require = createRequire(import.meta.url);
function load(file: string, mocks: any = {}) {
  const module = { exports: {} as any };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL("../lib/" + file, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) => ["./localLogout", "@/lib/localLogout"].includes(id) ? load("localLogout.ts") :
        id === "@/lib/oidcPolicy" ? load("oidcPolicy.ts") :
        id === "@/lib/oidcRenewal" ? load("oidcRenewal.ts") : mocks[id] || require(id),
      process,
      URL,
      Date,
      Buffer,
    }
  );
  return module.exports;
}
const policy = load("oidcPolicy.ts");
const client = load("oidcClient.ts", { "openid-client": openid, "./oidcPolicy": policy });
test("real openid-client requires JWKS signature, issuer/audience/nonce/state and PKCE for callback", async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let issuer = "",
    authorization: any,
    mode = "valid";
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/.well-known/openid-configuration")
      return res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: issuer + "/auth",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
        })
      );
    if (req.url === "/jwks")
      return res.end(
        JSON.stringify({
          keys: [
            { ...publicKey.export({ format: "jwk" }), kid: "fixture", use: "sig", alg: "RS256" },
          ],
        })
      );
    if (req.url === "/token") {
      assert.equal(
        req.headers.authorization,
        "Basic " + Buffer.from("ragent:" + "s".repeat(40)).toString("base64")
      );
      let raw = "";
      for await (const c of req) raw += c;
      const form = new URLSearchParams(raw);
      if (
        createHash("sha256")
          .update(form.get("code_verifier") || "")
          .digest("base64url") !== authorization.get("code_challenge")
      ) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: "invalid_grant" }));
      }
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        sub: "stable-uuid",
        iss: mode === "issuer" ? "https://evil.example" : issuer,
        aud: mode === "audience" ? "other-client" : "ragent",
        iat: now,
        exp: mode === "expired" ? now - 100 : now + 200,
        nonce: mode === "nonce" ? "wrong" : authorization.get("nonce"),
      };
      const body =
        Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture" })).toString("base64url") +
        "." +
        Buffer.from(JSON.stringify(payload)).toString("base64url");
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(body),
        mode === "signature" ? attacker.privateKey : privateKey
      ).toString("base64url");
      return res.end(
        JSON.stringify({
          token_type: "Bearer",
          access_token: "opaque-not-exposed",
          expires_in: 300,
          id_token: body + "." + signature,
        })
      );
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as any).port}`;
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const settings = policy.readOidcSettings({
    OIDC_ENABLED: "true",
    NODE_ENV: "test",
    OIDC_ALLOW_INSECURE_TEST_HTTP: "true",
    OIDC_ISSUER: issuer,
    OIDC_REDIRECT_URI: "http://127.0.0.1:31999/api/auth/oidc/callback",
    OIDC_CLIENT_ID: "ragent",
    OIDC_CLIENT_SECRET: "s".repeat(40),
    OIDC_TRANSACTION_KEY: "a".repeat(64),
  });
  async function attempt(selected: string, stateOverride?: string, logoutMarker = "") {
    mode = selected;
    const start = await client.startOidc(settings, "/chat", logoutMarker);
    authorization = new URL(start.redirectTo).searchParams;
    assert.equal(authorization.get("code_challenge_method"), "S256");
    assert.equal(authorization.get("prompt"), logoutMarker ? "login" : null);
    const query = new URLSearchParams({
      code: "fixture-code",
      state: stateOverride || authorization.get("state"),
      iss: issuer,
    });
    return client.completeOidc(settings, query.toString(), start.cookie, logoutMarker);
  }
  const success = await attempt("valid");
  assert.equal(success.sub, "stable-uuid");
  assert.equal(success.returnTo, "/chat");
  assert.equal(success.ttl, 604800);
  assert.equal(success.access_token, undefined);
  const forced = await client.startOidc(settings, "/user?signedOut=1&keep=value#section", "", true);
  assert.equal(new URL(forced.redirectTo).searchParams.get("prompt"), "login");
  assert.equal(policy.openTransaction(forced.cookie, settings.transactionKey).returnTo, "/user?keep=value#section");
  const explicit = await attempt("valid", undefined, "current-logout-generation");
  assert.equal(explicit.sub, "stable-uuid", "explicit re-login with matching logout generation succeeds");
  // Exercise the real callback with real verified protocol tokens and a DB mapping fixture.
  const begin = await client.startOidc(settings, "/chat");
  authorization = new URL(begin.redirectTo).searchParams;
  const jwt = require("jsonwebtoken");
  const auth = load("auth.ts", { jsonwebtoken: { default: jwt } });
  const callback = load("../pages/api/auth/oidc/callback.ts", {
    "@/lib/oidcClient": { ...client, readOidcSettings: () => settings },
    "@/lib/db": {
      default: {
        query: async (_sql: string, params: string[]) => {
          assert.equal(params[0], "stable-uuid");
          return { rows: [{ id: 7, status: "active" }] };
        },
      },
    },
    "@/lib/env": { requireEnv: () => "local-jwt-fixture-secret" },
    "@/lib/auth": auth,
    jsonwebtoken: { default: jwt },
  }).default;
  const headers: Record<string, any> = {};
  let destination = "";
  const response: any = {
    setHeader: (key: string, value: any) => {
      headers[key] = value;
    },
    getHeader: (key: string) => headers[key],
    redirect: (status: number, path: string) => {
      assert.equal(status, 303);
      destination = path;
    },
    status: (status: number) => {
      throw Error("Callback failed: " + status);
    },
  };
  await callback(
    {
      method: "GET",
      cookies: { ragent_oidc_tx: begin.cookie },
      url:
        "/api/auth/oidc/callback?" +
        new URLSearchParams({
          code: "fixture-code",
          state: authorization.get("state"),
          iss: issuer,
        }),
    },
    response
  );
  assert.equal(destination, "/chat");
  const sessionCookie = headers["Set-Cookie"].find((line: string) =>
    line.startsWith("ragent_token=")
  );
  assert.ok(sessionCookie.includes("HttpOnly"));
  const localToken = sessionCookie.split(";")[0].slice("ragent_token=".length);
  const localClaims = jwt.verify(localToken, "local-jwt-fixture-secret");
  assert.equal(localClaims.userId, 7);
  assert.equal(localClaims.exp - localClaims.iat, 604800);
  const cookieAge = Number(/Max-Age=(\d+)/.exec(sessionCookie)?.[1]);
  assert.ok(cookieAge > 604790 && cookieAge <= 604800);
  assert.equal(jwt.verify(localToken, "local-jwt-fixture-secret", {
    clockTimestamp: localClaims.iat + 604799,
  }).userId, 7);
  assert.throws(() => jwt.verify(localToken, "local-jwt-fixture-secret", {
    clockTimestamp: localClaims.iat + 604800,
  }), /jwt expired/);
  assert.ok(!JSON.stringify(headers).includes("opaque-not-exposed"));
  for (const invalid of ["signature", "issuer", "audience", "nonce", "expired"])
    await assert.rejects(() => attempt(invalid), invalid);
  await assert.rejects(() => attempt("valid", "incorrect-state"), "state mismatch");
});

test("encrypted transaction binds explicit login to the current local logout generation before exchange", async () => {
  const settings = { transactionKey: "a".repeat(64) };
  const base = { state:"state",nonce:"nonce",verifier:"verifier",returnTo:"/",createdAt:Math.floor(Date.now()/1000) };
  for(const [prior,current] of [["","new-logout"],["old-logout","new-logout"],["old-logout",""]]) {
    const sealed=policy.sealTransaction({...base,logoutMarker:prior},settings.transactionKey);
    await assert.rejects(client.completeOidc(settings,"code=fixture",sealed,current),/Session changed since sign-in started/);
  }
});
