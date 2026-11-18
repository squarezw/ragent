import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../lib/workspaceRoutePolicy.ts";
import * as logout from "../lib/localLogout.ts";
import * as locale from "../i18n/config.ts";

const require = createRequire(import.meta.url);
const next = require("next/server");
const module = { exports: {} as { middleware?: (request: unknown) => Response } };
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../middleware.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  {
    module,
    exports: module.exports,
    Headers,
    process,
    require: (name: string) => {
      if (name === "next/server") return next;
      if (name === "./lib/workspaceRoutePolicy") return policy;
      if (name === "./lib/localLogout") return logout;
      if (name === "./i18n/config") return locale;
      throw new Error(`Unexpected middleware dependency: ${name}`);
    },
  }
);
assert.ok(module.exports.middleware);
const middleware = module.exports.middleware;

for (const method of ["GET", "DELETE"]) {
  test(`${method} login state requires a workspace`, async () => {
    const response = middleware(new next.NextRequest("https://example.test/api/v1/skills/199/login-state", {method}));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {detail: {code: "WORKSPACE_TENANT_REQUIRED"}});
  });
  test(`${method} scoped login state reaches the authenticated API proxy`, () => {
    const response = middleware(new next.NextRequest("https://example.test/api/v1/skills/199/login-state", {method, headers: {"x-workspace-tenant-id": "2"}}));
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("x-middleware-request-x-workspace-tenant-id"), "2");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });
  test(`${method} unknown login-state children remain blocked`, () => {
    const response = middleware(new next.NextRequest("https://example.test/api/v1/skills/199/login-state/unknown", {method, headers: {"x-workspace-tenant-id": "2"}}));
    assert.equal(response.status, 501);
  });
}
