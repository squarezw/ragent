import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const routes = [
  ["apps/[id]/tenant-transfer/index.ts", "POST", "/api/v1/apps/9/tenant-transfer"],
  ["apps/[id]/tenant-transfer/preflight.ts", "POST", "/api/v1/apps/9/tenant-transfer/preflight"],
  [
    "apps/[id]/tenant-transfer/[transferId]/rollback-preflight.ts",
    "POST",
    "/api/v1/apps/9/tenant-transfer/event/rollback-preflight",
  ],
  [
    "apps/[id]/tenant-transfer/[transferId]/rollback.ts",
    "POST",
    "/api/v1/apps/9/tenant-transfer/event/rollback",
  ],
  ["app-tenant-transfer-requests/[key].ts", "GET", "/api/v1/app-tenant-transfer-requests/request"],
];
for (const [file, method, path] of routes)
  test(`actual dedicated proxy ${file} preserves source context and POST/GET contract`, async () => {
    let forwarded: any;
    const module = { exports: {} as any };
    vm.runInNewContext(
      ts.transpileModule(
        readFileSync(new URL(`../pages/api/v1/${file}`, import.meta.url), "utf8"),
        { compilerOptions: { module: ts.ModuleKind.CommonJS } }
      ).outputText,
      {
        module,
        exports: module.exports,
        require: () => ({
          proxySkillsApi: async (req: any, res: any, options: any) => {
            forwarded = { req, options };
          },
        }),
      }
    );
    const headers: any = {};
    const res = {
      setHeader: (k: string, v: string) => (headers[k] = v),
      status: () => res,
      json: () => {},
    };
    const req = {
      query: { id: "9", transferId: "event", key: "request" },
      headers: { "x-workspace-tenant-id": "1" },
      body: { target_tenant_id: 2 },
      method,
    };
    await module.exports.default(req, res);
    assert.equal(forwarded.options.path, path);
    assert.equal(forwarded.options.allow[0], method);
    assert.equal(forwarded.req, req);
    assert.equal(req.headers["x-workspace-tenant-id"], "1");
    assert.equal(headers["Cache-Control"], "private, no-store");
    forwarded = null;
    await module.exports.default(
      { ...req, query: { id: ["9", "10"], transferId: [], key: [] } },
      res
    );
    assert.equal(forwarded, null);
  });
