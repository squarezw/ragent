import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(file: string, mocks: any, env: any = {}) {
  const module = { exports: {} as any };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) => ["./localLogout", "./lib/localLogout"].includes(id) ? load("lib/localLogout.ts", {}, env) : mocks[id] || require(id),
      process: { env },
      Date,
      Headers,
    }
  );
  return module.exports;
}
test("OIDC Cookie precedes stale Bearer and /me refresh cannot extend signed JWT expiry", () => {
  const jwt = require("jsonwebtoken");
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign({ userId: 7, exp: now + 100 }, "fixture");
  const auth = load(
    "lib/auth.ts",
    { jsonwebtoken: { default: jwt } },
    { OIDC_ENABLED: "true", JWT_SECRET: "fixture", NODE_ENV: "production" }
  );
  assert.equal(
    auth.getTokenFromRequest({
      headers: { authorization: "Bearer stale" },
      cookies: { ragent_token: token },
    }),
    token
  );
  let header = "";
  auth.setAuthCookie({ setHeader: (_key: string, value: string) => (header = value) }, token);
  const maxAge = Number(/Max-Age=(\d+)/.exec(header)?.[1]);
  assert.ok(maxAge > 0 && maxAge <= 100);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
});
test("middleware only bridges same-app Cookie auth in OIDC mode, leaving auth endpoints and off mode unchanged", () => {
  for (const [enabled, path, expected] of [
    ["true", "/api/knowledge/list", "Bearer cookie-jwt"],
    ["false", "/api/knowledge/list", "Bearer old"],
    ["true", "/api/auth/oidc/callback", "Bearer old"],
  ]) {
    let forwarded: any;
    const m = load(
      "middleware.ts",
      {
        "next/server": {
          NextResponse: {
            next: (options: any) => {
              forwarded = options.request.headers;
              return { cookies: { set: () => {} } };
            },
          },
        },
        "./i18n/config": { locales: ["en"], defaultLocale: "en" },
      },
      { OIDC_ENABLED: enabled }
    );
    m.middleware({
      headers: new Headers({ authorization: "Bearer old" }),
      cookies: { get: (name: string) => name === "locale" ? { value: "en" } : name === "ragent_token" ? { value: "cookie-jwt" } : undefined },
      nextUrl: { pathname: path },
    });
    assert.equal(forwarded.get("authorization"), expected);
  }
});
