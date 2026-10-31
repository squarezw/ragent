import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture(allow: "knowledge" | "artifact" | "chat" | "avatar" | "none") {
  const calls: any[] = [];
  const exports: any = {};
  const imports: Record<string, any> = {
    "./db": {
      default: {
        query: async (sql: string, args: any[]) => {
          calls.push({ sql, args });
          const kind = sql.includes("FROM apps a") ? "avatar" : sql.includes("FROM knowledge_files")
            ? "knowledge"
            : sql.includes("external_workspace_resources")
              ? "artifact"
              : "chat";
          return { rows: kind === allow ? [{ id: 1 }] : [] };
        },
      },
    },
    "./visibilityScope": {
      buildVisibilityScope: async () => ({ conditions: ["cs.user_id=$3"], params: [7] }),
    },
    "./workspaceTenant": {},
  };
  runInNewContext(
    ts.transpileModule(readFileSync(new URL("../lib/workspaceFiles.ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in imports, name);
        return imports[name];
      },
    }
  );
  return { module: exports, calls };
}
const ctx = { enabled: true, tenantId: 10, actorUserId: 7 };
test("knowledge and trusted artifact mapping authorize fixed tenant plus old actor visibility", async () => {
  const k = fixture("knowledge");
  assert.equal(await k.module.workspaceCanReadObject(ctx, "object"), true);
  assert.deepEqual(Array.from(k.calls[0].args), ["object", 10, 7]);
  assert.match(k.calls[0].sql, /d.owner_tenant_id=\$2/);
  const a = fixture("artifact");
  assert.equal(await a.module.workspaceCanReadObject(ctx, "generated"), true);
  assert.match(a.calls[1].sql, /r.kind='skill_artifact'/);
  assert.match(a.calls[1].sql, /r.operation_tenant_id=\$2/);
  assert.match(a.calls[1].sql, /cs.user_id=\$3/);
});
test("chat upload ownership uses stored session operation tenant and structured attachments, never answer text", async () => {
  const c = fixture("chat");
  assert.equal(await c.module.workspaceCanReadObject(ctx, "uploaded"), true);
  const sql = c.calls.at(-1).sql;
  assert.match(sql, /cs.operation_tenant_id=\$2/);
  assert.match(sql, /jsonb_array_elements/);
  assert.doesNotMatch(sql, /answer|LIKE/);
  const missing = fixture("none");
  assert.equal(await missing.module.workspaceCanReadObject(ctx, "guess"), false);
});


test("app avatar requires an exact app reference, operation tenant and app visibility", async () => {
  const h = fixture("avatar");
  assert.equal(await h.module.workspaceCanReadObject(ctx, "app-avatars/image.png"), true);
  assert.deepEqual(Array.from(h.calls[0].args), ["/api/oss/app-avatars/image.png", 10, 7]);
  assert.match(h.calls[0].sql, /a.avatar_url=\$1 AND a.owner_tenant_id=\$2/);
  assert.match(h.calls[0].sql, /can_access_app\(\$3,a.id\)/);
  const denied = fixture("none");
  assert.equal(await denied.module.workspaceCanReadObject(ctx, "app-avatars/foreign.png"), false);
  assert.equal(denied.calls.length, 1);
});
