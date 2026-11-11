import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file: string, imports: Record<string, unknown>) {
  const module = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      module,
      exports: module.exports,
      process: { env: {} },
      URLSearchParams,
      require: (name: string) => imports[name],
    }
  );
  return module.exports;
}

test("candidate API uses authenticated workspace proxy, private no-store, GET only and no query overrides", async () => {
  let forwarded: unknown[] = [];
  const route = load("../pages/api/v1/remote-sandbox-environments.ts", {
    "@/lib/skillsProxy": {
      proxySkillsApi: async (...args: unknown[]) => {
        forwarded = args;
      },
    },
  });
  const headers: Record<string, unknown> = {};
  const req = {
    method: "GET",
    headers: { authorization: "Bearer test", "x-workspace-tenant-id": "3" },
    query: { region: "forbidden", tool_id: "forbidden" },
  };
  const res = {
    setHeader: (key: string, value: unknown) => {
      headers[key] = value;
    },
  };
  await route.default(req, res);
  assert.equal(forwarded[0], req);
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.deepEqual(JSON.parse(JSON.stringify(forwarded[2])), {
    path: "/api/v1/remote-sandbox-environments",
    allow: ["GET"],
  });
});

test("actual shared candidate proxy rejects anonymous/missing workspace and forwards authorized workspace headers", async () => {
  let authenticated = false;
  let request: Record<string, unknown> | null = null;
  const proxy = load("../lib/skillsProxy.ts", {
    "@/lib/auth": { getUserIdFromRequest: () => (authenticated ? 7 : null) },
    axios: {
      default: {
        request: async (options: Record<string, unknown>) => {
          request = options;
          return { status: 200, data: { items: [] }, headers: {} };
        },
      },
    },
  });
  let status = 0;
  const res = {
    setHeader: () => {},
    status: (value: number) => {
      status = value;
      return res;
    },
    json: (value: unknown) => value,
  };
  const options = { path: "/api/v1/remote-sandbox-environments", allow: ["GET"] };
  await proxy.proxySkillsApi({ method: "GET", headers: {}, query: {} }, res, options);
  assert.equal(status, 401);
  assert.equal(request, null);
  authenticated = true;
  await proxy.proxySkillsApi(
    { method: "GET", headers: { authorization: "Bearer test" }, query: {} },
    res,
    options
  );
  assert.equal(status, 409);
  assert.equal(request, null);
  await proxy.proxySkillsApi({ method: "POST", headers: {}, query: {} }, res, options);
  assert.equal(status, 405);
  assert.equal(request, null);
  await proxy.proxySkillsApi(
    {
      method: "GET",
      headers: { authorization: "Bearer test", "x-workspace-tenant-id": "3" },
      query: { region: "forbidden" },
    },
    res,
    options
  );
  assert.equal(status, 200);
  assert.ok(request);
  const actual = request as Record<string, unknown>;
  assert.equal(actual.url, "http://localhost:8010/api/v1/remote-sandbox-environments");
  assert.deepEqual(JSON.parse(JSON.stringify(actual.headers)), {
    "Content-Type": "application/json",
    "X-Workspace-Tenant-ID": "3",
    Authorization: "Bearer test",
  });
});


test("remote environment endpoint passes workspace middleware without exempting authorization", () => {
  const policy = load("../lib/workspaceRoutePolicy.ts", {});
  const routePolicy = policy.workspaceRoutePolicy as unknown as (path: string) => string;
  assert.equal(routePolicy("/api/v1/remote-sandbox-environments"), "covered");
  assert.equal(routePolicy("/api/v1/remote-sandbox-environments/unreviewed"), "blocked");
});
