import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      exports,
      process: { env: { EXTERNAL_API_BASE_URL: "http://private-backend" } },
      URLSearchParams,
      console: { error() {} },
      require: (key: string) => {
        assert.ok(key in imports, key);
        return imports[key];
      },
    }
  );
  return exports;
}

for (const route of ["executions/index", "[id]", "[id]/statistics"]) {
  test(`${route}: forwards the authenticated browser identity, never actor/tenant overrides`, async () => {
    let request: { url: string; headers: Record<string, string> } | undefined;
    const handler = load(`../pages/api/tools/${route}.ts`, {
      "@/lib/auth": {
        getUserIdFromRequest: () => 17,
        getTokenFromRequest: () => "selected-cookie",
      },
      axios: {
        default: {
          get: async (url: string, config: { headers: Record<string, string> }) => {
            request = { url, headers: config.headers };
            return { data: { total: 1 } };
          },
        },
      },
    }).default;
    let status = 200;
    const res = {
      setHeader() {},
      status(code: number) {
        status = code;
        return res;
      },
      json() {},
    };
    await handler(
      {
        method: "GET",
        query: {
          id: "5",
          tool_id: "5",
          page: "2",
          user_id: "999",
          tenant_id: "777",
          include_statistics: "true",
        },
        headers: { authorization: "Bearer stale", "x-api-key": "another-identity" },
        cookies: { ragent_token: "selected-cookie" },
      },
      res
    );
    assert.equal(status, 200);
    assert.ok(request);
    assert.equal(request.headers.Authorization, "Bearer selected-cookie");
    assert.equal(request.headers["X-API-Key"], undefined);
    assert.ok(request.url.startsWith("http://private-backend/api/v1/tools"));
    assert.ok(!request.url.includes("user_id"));
    assert.ok(!request.url.includes("tenant_id"));
  });

  test(`${route}: anonymous cannot query records or statistics`, async () => {
    let calls = 0;
    const handler = load(`../pages/api/tools/${route}.ts`, {
      "@/lib/auth": { getUserIdFromRequest: () => null, getTokenFromRequest: () => null },
      axios: {
        default: {
          get: async () => {
            calls++;
            return { data: {} };
          },
        },
      },
    }).default;
    let status = 200;
    const res = {
      setHeader() {},
      status(code: number) {
        status = code;
        return res;
      },
      json() {},
    };
    await handler({ method: "GET", query: { id: "5" }, headers: {}, cookies: {} }, res);
    assert.equal(status, 401);
    assert.equal(calls, 0);
  });
}

test("execution cache is partitioned by viewer and disabled before identity is known", () => {
  const keys: unknown[] = [];
  const module = load("../hooks/useToolExecutions.ts", {
    swr: {
      default: (key: unknown) => {
        keys.push(key);
        return {};
      },
    },
    "@/lib/axios": { default: {} },
  });
  module.useToolExecutions({ tool_id: 5 }, null);
  module.useToolExecutions({ tool_id: 5 }, 17);
  module.useToolExecutions({ tool_id: 5 }, 18);
  assert.equal(keys[0], null);
  assert.equal((keys[1] as unknown[])[1], 17);
  assert.equal((keys[2] as unknown[])[1], 18);
  assert.equal((keys[1] as unknown[])[0], (keys[2] as unknown[])[0]);
});
