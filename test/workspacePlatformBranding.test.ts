import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
function harness(file: string, superadmin = false, active = true) {
  let calls = 0;
  let upstream: any;
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    process: { env: { WORKSPACE_TENANT_ENABLED: "true" } },
    URLSearchParams,
    AbortSignal,
    console,
    fetch: async (_url: string, options: any) => {
      calls++;
      upstream = options;
      return { ok: true, status: 200, json: async () => ({ objectKey: "system/logo.png" }) };
    },
    require(name: string) {
      if (name === "@/lib/auth")
        return { getUserIdFromRequest: () => 2, getTokenFromRequest: () => "test-only-token" };
      if (name === "@/lib/permissions") return { isSuperAdmin: async () => superadmin };
      if (name === "@/lib/db")
        return {
          query: async () => ({ rows: active ? [{ id: 2 }] : [] }),
          connect: async () => ({
            release() {},
            query: async (sql: string) => ({
              rows: sql.includes("information_schema")
                ? []
                : [
                    {
                      platform_name: "Test brand",
                      platform_logo: "/logo.png",
                      smtp_password: "must-not-expose",
                    },
                  ],
            }),
          }),
        };
      if (name === "axios")
        return {
          get: async () => {
            calls++;
            throw Error("unexpected full settings request");
          },
        };
      if (name === "@/lib/htmlSanitizer" || name === "@/lib/theme") return {};
      throw Error(name);
    },
  });
  const res: any = {
    code: 200,
    setHeader() {},
    status(n: number) {
      this.code = n;
      return this;
    },
    json(data: any) {
      this.data = data;
      return this;
    },
    end() {
      return this;
    },
  };
  return { handler: module.exports.default, res, calls: () => calls, upstream: () => upstream };
}
test("ordinary users receive only public branding without fetching full platform configuration", async () => {
  const h = harness("pages/api/system/index.ts");
  await h.handler({ method: "GET", headers: {}, query: { full_data: "true" } }, h.res);
  assert.equal(h.res.code, 200);
  assert.equal(h.res.data.platform_name, "Test brand");
  assert.equal(h.calls(), 0);
  assert.equal("smtp_password" in h.res.data, false);
});
test("disabled super administrators cannot read full platform settings", async () => {
  const h = harness("pages/api/system/index.ts", true, false);
  await h.handler({ method: "GET", headers: {}, query: {} }, h.res);
  assert.equal(h.res.code, 401);
  assert.equal(h.calls(), 0);
});
test("logo presign is an active-super platform action independent of browser tenant", async () => {
  for (const [superadmin, active, status] of [
    [false, true, 403],
    [true, false, 401],
    [true, true, 200],
  ] as const) {
    const h = harness("pages/api/system/logo-presign.ts", superadmin, active);
    await h.handler(
      {
        method: "POST",
        headers: { "x-workspace-tenant-id": "999", "x-api-key": "ignored" },
        body: { filename: "logo.png", contentType: "image/png", size: 100, category: "forged" },
      },
      h.res
    );
    assert.equal(h.res.code, status);
    assert.equal(h.calls(), status === 200 ? 1 : 0);
    if (status === 200) {
      const request = h.upstream();
      assert.equal(JSON.parse(request.body).category, "system");
      assert.equal(request.headers["X-Workspace-Tenant-ID"], undefined);
      assert.equal(request.headers["X-API-Key"], undefined);
    }
  }
});
test("invalid logo metadata is rejected before upload authorization", async () => {
  const h = harness("pages/api/system/logo-presign.ts", true, true);
  await h.handler(
    {
      method: "POST",
      headers: {},
      body: { filename: "secret.pdf", contentType: "application/pdf", size: 100 },
    },
    h.res
  );
  assert.equal(h.res.code, 400);
  assert.equal(h.calls(), 0);
});
