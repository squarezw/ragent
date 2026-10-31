import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

function harness(context: any, returned: string[] = []) {
  const sql: any[] = [];
  const source = fs.readFileSync(new URL("../lib/workspaceKnowledge.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(compiled, { module, exports: module.exports, require(name: string) {
    if (name === "./workspaceTenant") return { requireWorkspaceTenant: async (_req: any, res: any) => {
      if (context === null) res.status(409).json({ error: "missing" });
      return context;
    }};
    if (name === "./db") return { __esModule: true, default: { query: async (query: string, params: any[]) => {
      sql.push({ query, params }); return { rows: returned.map(id => ({ id })) };
    }}};
    throw new Error(name);
  }});
  const response: any = { statusCode: 200, headersSent: false, status(value: number) { this.statusCode=value;return this; }, json(value: any) { this.data=value;this.headersSent=true;return this; } };
  return { api: module.exports, sql, response };
}
const scope = { enabled: true, tenantId: 6, actorUserId: 2, isSuperAdmin: true };

test("tenant boundary denies a super-admin's foreign dataset before invoking the handler", async () => {
  const h=harness(scope);let called=false;
  await h.api.withKnowledgeWorkspace(() => { called=true; }, "dataset")({query:{id:"foreign"},body:{}},h.response);
  assert.equal(h.response.statusCode,404);assert.equal(called,false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.sql[0].params)),[["foreign"],6,2]);
  assert.match(h.sql[0].query,/owner_tenant_id=\$2/);
  assert.match(h.sql[0].query,/can_access_dataset/);
});
test("mixed-tenant bulk requests cannot partially execute", async () => {
  const h=harness(scope,["own"]);let writes=0;
  await h.api.withKnowledgeWorkspace(() => { writes++; })({query:{},body:{dataset_ids:["own","foreign"]}},h.response);
  assert.equal(h.response.statusCode,404);assert.equal(writes,0);
});
test("same-tenant requests preserve the old handler and expose the immutable tenant", async () => {
  const h=harness(scope,["own"]);let tenant;
  await h.api.withKnowledgeWorkspace((req: any) => { tenant=h.api.knowledgeWorkspaceTenantId(req); },"dataset")({query:{id:"own"},body:{}},h.response);
  assert.equal(tenant,6);assert.equal(h.response.statusCode,200);
});
test("disabled feature does not query new schema or alter legacy requests", async () => {
  const h=harness({enabled:false,tenantId:null,actorUserId:2});let called=false;
  await h.api.withKnowledgeWorkspace(() => { called=true; },"dataset")({query:{id:"any"},body:{}},h.response);
  assert.equal(called,true);assert.equal(h.sql.length,0);
});
test("forged creation owner and missing workspace cannot reach the handler", async () => {
  for (const context of [scope,null]) {
    const h=harness(context);let called=false;
    await h.api.withKnowledgeWorkspace(() => { called=true; })({query:{},body:{owner_tenant_id:99}},h.response);
    assert.equal(called,false);assert.equal(h.sql.length,0);
    assert.equal(h.response.statusCode,context ? 403 : 409);
  }
});
test("replacement file IDs and segment IDs are validated through their dataset", async () => {
  const h=harness(scope,["8"]);
  await h.api.withKnowledgeWorkspace(() => undefined)({query:{},body:{replaceMap:{"x.pdf":[8]},segment_ids:[8]}},h.response);
  assert.equal(h.sql.length,2);
  assert.ok(h.sql.every(({query}: any) => query.includes("JOIN datasets d") && query.includes("can_access_dataset")));
});


test("public dataset and file reads include sharing but write gates remain tenant-owned", async () => {
  for (const method of ["GET", "HEAD", "PUT", "DELETE", "POST"]) {
    const h = harness(scope, ["shared"]);
    let called = false;
    await h.api.withKnowledgeWorkspace(() => { called = true; }, "dataset")(
      {method, query: {id: "shared"}, body: {}}, h.response
    );
    assert.equal(called, true);
    assert.match(h.sql[0].query, /can_access_dataset/);
    if (method === "GET" || method === "HEAD") {
      assert.match(h.sql[0].query, /owner_tenant_id=\$2 OR d.visibility='public'/);
      // Tenant administrators' old function may return false even for public data.
      assert.match(h.sql[0].query, /can_access_dataset\(\$3,d.id\) OR d.visibility='public'/);
    } else {
      assert.doesNotMatch(h.sql[0].query, /visibility='public'/);
    }
  }
});

test("shared dataset membership never makes private tags readable across tenants", async () => {
  const h = harness(scope, ["8"]);
  await h.api.withKnowledgeWorkspace(() => undefined, "tag")(
    {method: "GET", query: {id: "8"}, body: {}}, h.response
  );
  assert.doesNotMatch(h.sql[0].query, /visibility='public'/);
  assert.match(h.sql[0].query, /owner_tenant_id=\$2/);
});
