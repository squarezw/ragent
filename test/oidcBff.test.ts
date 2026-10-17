import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const nodeRequire = createRequire(import.meta.url);
function load(file: string, mocks: any) {
  const module = { exports: {} as any };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) => id === "@/lib/localLogout" ? load("lib/localLogout.ts", {}) :
        id === "@/lib/oidcRenewal" ? load("lib/oidcRenewal.ts", {}) :
        id === "@/lib/oidcPolicy" ? load("lib/oidcPolicy.ts", {}) : mocks[id] || nodeRequire(id),
      process: { env: { NODE_ENV: "test" } },
      URL,
      Date,
      console,
    }
  );
  return module.exports;
}
async function callback(options: any = {}) {
  let status = 200;
  const headers: any = {};
  const signed: any[] = [];
  const queries: any[] = [];
  let body: any, redirect: any;
  const mocks: any = {
    "@/lib/oidcClient": {
      readOidcSettings: () =>
        options.off
          ? null
          : {
              redirectUri: "https://app.example/api/auth/oidc/callback",
              transactionKey: "fixture",
            },
      TRANSACTION_COOKIE: "ragent_oidc_tx",
      TRANSACTION_PATH: "/api/auth/oidc",
      completeOidc: async () => {
        if (options.invalid) throw Error("bad proof");
        return { sub: "verified-sub", ttl: 120, returnTo: "/chat" };
      },
    },
    "@/lib/db": {
      default: {
        query: async (sql: string, params: any[]) => {
          queries.push({ sql, params });
          return {
            rows: options.missing
              ? []
              : [{ id: 7, status: options.disabled ? "disabled" : "active" }],
          };
        },
      },
    },
    "@/lib/env": { requireEnv: () => "fixture-jwt-key" },
    "@/lib/auth": {
      setAuthCookie: (res: any, token: any) => res.setHeader("Set-Cookie", "session=" + token),
    },
    jsonwebtoken: {
      default: {
        sign: (payload: any, _key: any, config: any) => {
          signed.push({ payload, config });
          return "local-jwt";
        },
      },
    },
  };
  const handler = load("pages/api/auth/oidc/callback.ts", mocks).default;
  const res: any = {
    setHeader: (k: string, v: any) => (headers[k] = v),
    getHeader: (k: string) => headers[k],
    status: (s: number) => {
      status = s;
      return res;
    },
    json: (b: any) => (body = b),
    redirect: (s: number, u: string) => {
      status = s;
      redirect = u;
      return res;
    },
  };
  await handler(
    {
      method: "GET",
      cookies: { ragent_oidc_tx: "encrypted-transaction" },
      url: "/api/auth/oidc/callback?code=one&state=state",
      query: {},
    },
    res
  );
  return { status, headers, signed, queries, body, redirect };
}
test("callback signs only mapped active user, bounded JWT and HttpOnly transport, never OIDC tokens", async () => {
  const r = await callback();
  assert.equal(r.status, 303);
  assert.equal(r.redirect, "/chat");
  assert.equal(JSON.stringify(r.signed[0].payload), JSON.stringify({ userId: 7 }));
  assert.equal(r.signed[0].config.expiresIn, 120);
  assert.match(r.queries[0].sql, /identity_subjects/);
  assert.deepEqual(Array.from(r.queries[0].params), ["verified-sub"]);
  assert.equal(r.body, undefined);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.ok(r.headers["Set-Cookie"].some((s: string) => s.includes("Max-Age=0")));
});
test("callback fails closed on missing mapping, disabled user, bad proof and feature off", async () => {
  for (const opts of [{ missing: true }, { disabled: true }, { invalid: true }, { off: true }]) {
    const r = await callback(opts);
    assert.ok(r.status >= 400);
    assert.equal(r.signed.length, 0);
    assert.equal(r.redirect, undefined);
  }
});
