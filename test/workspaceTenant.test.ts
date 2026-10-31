import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import jwt from "jsonwebtoken";

function load(file: string, imports: Record<string, any>, env: Record<string, string> = {}) {
  const exports: any = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      exports,
      process: { env },
      Headers,
      URL,
      URLSearchParams,
      require: (name: string) => {
        assert.ok(name in imports, name);
        return imports[name];
      },
    }
  );
  return exports;
}
function fixture(
  superAdmin = false,
  accountTenantId: number | null = 10,
  active = true,
  enabled = true
) {
  const calls: any[] = [];
  const module = load(
    "../lib/workspaceTenant.ts",
    {
      "./auth": { getUserIdFromRequest: () => 7 },
      "./permissions": {
        getUserPermissions: async () => ({
          roles: superAdmin ? [{ name: "超级管理员", isSystem: true }] : [],
        }),
      },
      "./db": {
        default: {
          query: async (sql: string, args: any[]) => {
            calls.push({ sql, args });
            return {
              rows: sql.includes("FROM users")
                ? [{ tenant_id: accountTenantId, status: "active" }]
                : active
                  ? [{ id: args[0] }]
                  : [],
            };
          },
        },
      },
    },
    enabled ? { WORKSPACE_TENANT_ENABLED: "true" } : {}
  );
  let status = 200;
  let body: any;
  const res: any = {
    status(value: number) {
      status = value;
      return res;
    },
    json(value: any) {
      body = value;
      return res;
    },
  };
  return { module, calls, res, status: () => status, body: () => body };
}

test("default-off preserves legacy calls without database work", async () => {
  const f = fixture(false, 10, true, false);
  assert.equal(
    (await f.module.requireWorkspaceTenant({ headers: {}, query: {} }, f.res)).enabled,
    false
  );
  assert.equal(f.calls.length, 0);
});
test("super administrator must select active tenant; real account remains unchanged", async () => {
  const f = fixture(true, 10);
  assert.equal(await f.module.requireWorkspaceTenant({ headers: {}, query: {} }, f.res), null);
  assert.equal(f.status(), 409);
  const ctx = await f.module.requireWorkspaceTenant(
    { headers: { "x-workspace-tenant-id": "20" }, query: {} },
    f.res
  );
  assert.equal(ctx.tenantId, 20);
  assert.equal(ctx.accountTenantId, 10);
  assert.equal(ctx.actorUserId, 7);
});
test("ordinary member cannot forge workspace; inactive tenant is refused", async () => {
  const f = fixture();
  assert.equal(
    await f.module.requireWorkspaceTenant(
      { headers: { "x-workspace-tenant-id": "20" }, query: {} },
      f.res
    ),
    null
  );
  assert.equal(f.status(), 403);
  const inactive = fixture(true, 10, false);
  assert.equal(
    await inactive.module.requireWorkspaceTenant(
      { headers: { "x-workspace-tenant-id": "20" }, query: {} },
      inactive.res
    ),
    null
  );
  assert.equal(inactive.body().detail.code, "WORKSPACE_TENANT_INVALID");
});
test("download query is verified exactly like headers and conflict is refused", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.module.requireWorkspaceTenant(
        { headers: {}, query: { workspace_tenant_id: "10" } },
        f.res
      )
    ).tenantId,
    10
  );
  assert.equal(
    await f.module.requireWorkspaceTenant(
      { headers: { "x-workspace-tenant-id": "10" }, query: { workspace_tenant_id: "20" } },
      f.res
    ),
    null
  );
  assert.equal(f.status(), 403);
});

test("workspace upload receipt rejects cross-tenant, cross-actor and excessive TTL reuse", () => {
  const secret = "offline-workspace-test-secret";
  const module = load(
    "../lib/workspaceUploadReceipt.ts",
    { jsonwebtoken: { default: jwt } },
    { JWT_SECRET: secret }
  );
  const ctx = { enabled: true, tenantId: 10, actorUserId: 7 };
  const claims = {
    v: 2,
    purpose: "workspace_upload",
    sub: "7",
    object_key: "attachments/a.png",
    content_type: "image/png",
    operation_tenant_id: 10,
  };
  const sign = (extra = {}, ttl = 7200) =>
    jwt.sign({ ...claims, ...extra }, secret, {
      algorithm: "HS256",
      issuer: "ragent-upload",
      audience: "ragent-workspace-upload",
      expiresIn: ttl,
    });
  assert.equal(
    module.verifyWorkspaceUploadReceipt(ctx, sign(), claims.object_key, "image/png"),
    true
  );
  assert.equal(
    module.verifyWorkspaceUploadReceipt(ctx, sign({ operation_tenant_id: 20 }), claims.object_key),
    false
  );
  assert.equal(
    module.verifyWorkspaceUploadReceipt(ctx, sign({ sub: "8" }), claims.object_key),
    false
  );
  assert.equal(module.verifyWorkspaceUploadReceipt(ctx, sign({}, 7201), claims.object_key), false);
  assert.equal(module.verifyWorkspaceUploadReceipt(ctx, sign(), "other-key"), false);
  assert.equal(
    module.verifyWorkspaceUploadReceipt(ctx, sign(), claims.object_key, "application/pdf"),
    false
  );
});

test("route inventory denies new unknown business endpoints and keeps credential integrations distinct", () => {
  const module = load("../lib/workspaceRoutePolicy.ts", {});
  assert.equal(module.workspaceRoutePolicy("/api/v1/apps/123"), "covered");
  assert.equal(module.workspaceRoutePolicy("/api/v1/apps/123/datasets/cleanup-unavailable"), "covered");
  assert.equal(module.workspaceRoutePolicy("/api/knowledge/list"), "covered");
  assert.equal(module.workspaceRoutePolicy("/api/internal/onlyoffice/config/doc"), "covered");
  assert.equal(module.workspaceRoutePolicy("/api/organization/pending-users"), "exempt");
  assert.equal(module.workspaceRoutePolicy("/api/internal/onlyoffice/callback"), "exempt");
  assert.equal(module.workspaceRoutePolicy("/api/oss/system/logo.png"), "exempt");
  assert.equal(module.workspaceRoutePolicy("/api/oss/attachments/private.png"), "covered");
  assert.equal(module.workspaceRoutePolicy("/api/business-added-later"), "blocked");
});

test("actual middleware refuses unknown/missing/conflicting context before handlers and forwards valid native query", () => {
  const policy = load("../lib/workspaceRoutePolicy.ts", {});
  const module = load(
    "../middleware.ts",
    {
      "./lib/localLogout": { LOCAL_LOGOUT_COOKIE: "logout" },
      "./lib/workspaceRoutePolicy": policy,
      "./i18n/config": { locales: ["en"], defaultLocale: "en" },
      "next/server": {
        NextResponse: {
          json: (body: any, options: any) => ({ body, status: options.status }),
          next: (options: any) => ({
            status: 200,
            headers: new Headers(),
            forwarded: options.request.headers,
            cookies: { set() {} },
          }),
        },
      },
    },
    { WORKSPACE_TENANT_ENABLED: "true" }
  );
  const request = (path: string, headers = {}) => ({
    headers: new Headers(headers),
    cookies: { get: () => ({ value: "en" }) },
    nextUrl: new URL(path, "https://app.invalid"),
  });
  assert.equal(module.middleware(request("/api/new-unknown-business")).status, 501);
  assert.equal(module.middleware(request("/api/v1/apps")).status, 409);
  assert.equal(
    module.middleware(
      request("/api/v1/apps?workspace_tenant_id=20", { "x-workspace-tenant-id": "10" })
    ).status,
    403
  );
  assert.equal(
    module
      .middleware(request("/api/oss/file.pdf?workspace_tenant_id=20"))
      .forwarded.get("x-workspace-tenant-id"),
    "20"
  );
  assert.equal(module.middleware(request("/api/oss/system/logo.png")).status, 200);
  const scoped = module.middleware(request("/api/v1/apps?workspace_tenant_id=20"));
  assert.equal(scoped.headers.get("cache-control"), "private, no-store");
  assert.match(scoped.headers.get("vary"), /X-Workspace-Tenant-ID/);
});
