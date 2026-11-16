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

test("actual middleware requires workspace for knowledge binding PUT", async () => {
  const response = middleware(
    new next.NextRequest("https://example.test/api/v1/apps/60/datasets", { method: "PUT" })
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { detail: { code: "WORKSPACE_TENANT_REQUIRED" } });
});

test("actual middleware allows scoped knowledge binding PUT with no-store headers", () => {
  const response = middleware(
    new next.NextRequest("https://example.test/api/v1/apps/60/datasets", {
      method: "PUT",
      headers: { "x-workspace-tenant-id": "8" },
    })
  );
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("x-middleware-request-x-workspace-tenant-id"), "8");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("actual middleware still blocks unregistered app endpoints", async () => {
  const response = middleware(
    new next.NextRequest("https://example.test/api/v1/apps/60/not-registered", {
      method: "PUT",
      headers: { "x-workspace-tenant-id": "8" },
    })
  );
  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), { detail: { code: "WORKSPACE_ROUTE_NOT_READY" } });
});

for (const workspace of [false, true]) {
  test(`actual DELETE middleware ${workspace ? "allows scoped requests" : "requires workspace"}`, async () => {
    const response = middleware(
      new next.NextRequest("https://example.test/api/v1/apps/60/datasets/knowledge", {
        method: "DELETE",
        headers: workspace ? { "x-workspace-tenant-id": "8" } : {},
      })
    );
    if (workspace) assert.equal(response.headers.get("x-middleware-next"), "1");
    else {
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { detail: { code: "WORKSPACE_TENANT_REQUIRED" } });
    }
  });
}

test("unknown DELETE child remains blocked", async () => {
  const response = middleware(
    new next.NextRequest("https://example.test/api/v1/apps/60/datasets/knowledge/unknown", {
      method: "DELETE",
      headers: { "x-workspace-tenant-id": "8" },
    })
  );
  assert.equal(response.status, 501);
});
