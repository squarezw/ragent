import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
function harness(allowed = true) {
  const sql: string[] = [];
  let active = true;
  const source = fs.readFileSync(new URL("../lib/workspaceOnlyOffice.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    process,
    require(name: string) {
      if (name === "jsonwebtoken") return require(name);
      if (name === "axios")
        return {
          get: async (url: string) => ({
            data: {
              data: url.includes("process-documents")
                ? { node_id: "node" }
                : { company_code: allowed ? "MAGIC" : "OTHER" },
            },
          }),
        };
      if (name === "./db")
        return {
          query: async (q: string) => {
            sql.push(q);
            return { rows: (q.includes("FROM users u") ? active : allowed) ? [{}] : [] };
          },
        };
      if (name === "./tenantMapping") return { getCompanyCodeByTenantId: () => "MAGIC" };
      if (name === "./workspaceTenant")
        return {
          requireWorkspaceTenant: async () => ({ enabled: true, tenantId: 6, actorUserId: 3 }),
        };
      if (name === "./env")
        return {
          requireEnv: (name: string) =>
            name === "JWT_SECRET" ? "actor-test-secret" : "office-test-secret",
        };
      throw Error(name);
    },
  });
  return {
    api: module.exports,
    sql,
    deactivate() {
      active = false;
    },
  };
}
const scope = { actor: 3, tenant: 6, type: "doc", id: "123", key: "doc_123_v1_12345" };
test("office capability binds actor, tenant, resource and exact editor key", async () => {
  const h = harness();
  const token = h.api.signOfficeScope(scope);
  assert.ok(await h.api.verifyOfficeScope(token, "doc", "123", scope.key));
  assert.equal(await h.api.verifyOfficeScope(token, "doc", "other", scope.key), null);
  assert.equal(await h.api.verifyOfficeScope(token, "session", "123", scope.key), null);
  assert.equal(await h.api.verifyOfficeScope(token, "doc", "123", "other-key"), null);
  h.deactivate();
  assert.equal(await h.api.verifyOfficeScope(token, "doc", "123", scope.key), null);
});
test("tenant mismatch is rejected after a correctly signed capability", async () => {
  const h = harness(false);
  const token = h.api.signOfficeScope(scope);
  assert.equal(await h.api.verifyOfficeScope(token, "doc", "123", scope.key), null);
});
test("file and handbook capabilities recheck database ownership before access", async () => {
  const h = harness();
  for (const type of ["file", "session"]) {
    const token = h.api.signOfficeScope({ ...scope, type });
    assert.ok(await h.api.verifyOfficeScope(token, type, "123"));
  }
  assert.ok(
    h.sql.some((q) => q.includes("owner_tenant_id=$2") && q.includes("can_access_dataset"))
  );
  assert.ok(
    h.sql.some(
      (q) => q.includes("external_workspace_resources") && q.includes("operation_tenant_id=$2")
    )
  );
  assert.ok(h.sql[0].includes("u.tenant_id=t.id") && h.sql[0].includes("is_system=true"));
});
test("backend delegation is short-lived and retains the real actor and operation tenant", () => {
  const h = harness();
  const headers = h.api.officeBackendHeaders(scope);
  const claims = require("jsonwebtoken").verify(
    headers.Authorization.slice(7),
    "actor-test-secret"
  );
  assert.equal(claims.userId, 3);
  assert.equal(claims.exp - claims.iat, 60);
  assert.equal(headers["X-Workspace-Tenant-ID"], "6");
});
function callbackHarness() {
  const source = fs.readFileSync(
    new URL("../pages/api/internal/onlyoffice/callback.ts", import.meta.url),
    "utf8"
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} as any };
  let saves = 0,
    downloads = 0;
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Buffer,
    URL,
    console,
    process: {
      env: { WORKSPACE_TENANT_ENABLED: "true", NEXT_PUBLIC_ONLYOFFICE_URL: "http://office" },
    },
    require(name: string) {
      if (name === "jsonwebtoken") return require(name);
      if (name === "axios")
        return {
          get: async () => {
            downloads++;
            return { data: Buffer.from("file") };
          },
        };
      if (name === "@/lib/workspaceOnlyOffice")
        return {
          verifyOfficeScope: async (token: string, _type: string, _id: string, key: string) =>
            token === "cap" && key === "doc_123_v1_1" ? scope : null,
        };
      if (name === "@/lib/documentFileVersions")
        return {
          saveDraft: async () => {
            saves++;
            return true;
          },
        };
      if (name === "@/lib/onlyofficeKey")
        return {
          parseOnlyOfficeKey: (key: string) => ({
            type: key.split("_")[0],
            id: key.split("_")[1],
            version: 1,
          }),
        };
      if (name === "@/lib/env") return { requireEnv: () => "office-test-secret" };
      throw Error(name);
    },
  });
  return { handler: module.exports.default, counts: () => ({ saves, downloads }) };
}
test("callback requires both resource capability and signed matching OnlyOffice body", async () => {
  const h = callbackHarness();
  const body = { key: "doc_123_v1_1", status: 6, url: "http://office/cache/file.docx" };
  const signed = require("jsonwebtoken").sign(body, "office-test-secret", { algorithm: "HS256" });
  async function call(value: any, token?: string, cap = "cap") {
    const res: any = {
      code: 200,
      status(n: number) {
        this.code = n;
        return this;
      },
      json(data: any) {
        this.data = data;
        return this;
      },
    };
    await h.handler(
      {
        method: "POST",
        query: { cap },
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: value,
      },
      res
    );
    return res;
  }
  assert.equal((await call(body)).code, 403);
  assert.equal((await call({ ...body, url: "http://office/altered" }, signed)).code, 403);
  assert.equal((await call(body, signed, "wrong")).code, 403);
  assert.deepEqual(h.counts(), { saves: 0, downloads: 0 });
  assert.equal((await call(body, signed)).data.error, 0);
  assert.deepEqual(h.counts(), { saves: 1, downloads: 1 });
});
