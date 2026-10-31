import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function confirm(canUpload: boolean, canEdit: boolean, replaceMap?: unknown, replacementRows?: { id: string; originalname: string }[], replaceSuccess = true) {
  const calls: string[] = [];
  const queries: string[] = [];
  let signed = 0;
  const deletes: { sql: string; params: unknown[] }[] = [];
  const deletedObjects: string[] = [];
  const module = { exports: {} as any };
  const source = readFileSync(new URL("../pages/api/knowledge/upload-confirm.ts", import.meta.url), "utf8");
  const mocks: Record<string, unknown> = {
    "@/lib/workspaceUploadReceipt": { verifyWorkspaceUploadReceipt: () => true },
    "@/lib/workspaceKnowledge": {
      withKnowledgeWorkspace: (handler: unknown) => handler,
      knowledgeWorkspaceContext: () => ({ enabled: true, tenantId: 6, actorUserId: 2 }),
    },
    "@/lib/workspaceTenant": { workspaceHeaders: () => ({}) },
    "@/lib/auth": { getUserIdFromRequest: () => 2 },
    "@/lib/db": { default: {
      connect: async () => ({
        query: async (sql: string) => {
          queries.push(sql);
          return { rows: sql.includes("SELECT id::text")
            ? replacementRows ?? [{ id: "7", originalname: "same-name.pdf" }]
            : [{ can_upload: canUpload, can_edit: canEdit }] };
        },
        release() {},
      }),
      query: async (sql: string, params: unknown[]) => {
        if (sql.startsWith("DELETE")) {
          deletes.push({ sql, params });
          return { rows: sql.includes("RETURNING object_key") ? [{ object_key: "old-object" }] : [] };
        }
        return { rows: [] };
      },
    } },
    "@/lib/ossClient": { ossClient: {
      sign: async () => { signed++; return { url: "https://fixture.invalid/file" }; },
      delete: async ({ objectKey }: { objectKey: string }) => { deletedObjects.push(objectKey); },
    } },
    "@/lib/logError": { logError: () => {} },
    axios: { default: { post: async (url: string) => {
      calls.push(url); return { data: { success: replaceSuccess, file_id: "1" } };
    } } },
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, {
    module, exports: module.exports, process: { env: {} }, console,
    require: (name: string) => {
      if (!(name in mocks)) throw new Error(`Unexpected import ${name}`);
      return mocks[name];
    },
  });
  const response: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(data: unknown) { this.data = data; return this; },
  };
  await module.exports.default({ method: "POST", headers: {}, body: {
    objectKey: "fixture", originalFilename: "same-name.pdf", contentType: "application/pdf",
    datasetId: "fixture", uploadReceipt: "fixture", replaceMap,
  } }, response);
  return { response, calls, signed, queries, deletes, deletedObjects };
}

test("shared contributors register new documents without receiving edit permission", async () => {
  const result = await confirm(true, false);
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.calls.length, 1);
  assert.match(result.calls[0], /\/files\/register$/);
  assert.match(result.queries[0], /can_upload_dataset/);
  assert.match(result.queries[0], /can_edit_dataset/);
});

test("contributors cannot forge replacement maps, even under another filename", async () => {
  for (const map of [{ "same-name.pdf": ["7"] }, { "other.pdf": ["7"] }]) {
    const result = await confirm(true, false, map);
    assert.equal(result.response.statusCode, 403);
    assert.equal(result.signed, 0);
    assert.equal(result.calls.length, 0);
  }
});

test("existing editors retain replacement while read-only access cannot register files", async () => {
  const editor = await confirm(true, true, { "same-name.pdf": ["7"] });
  assert.equal(editor.response.statusCode, 200);
  assert.match(editor.calls[0], /\/files\/replace$/);
  const readOnly = await confirm(false, false);
  assert.equal(readOnly.response.statusCode, 403);
  assert.equal(readOnly.signed, 0);
  assert.equal(readOnly.calls.length, 0);
});

test("forged secondary file from a different dataset or filename is rejected before any side effect", async () => {
  for (const rows of [
    [{ id: "7", originalname: "same-name.pdf" }],
    [{ id: "7", originalname: "same-name.pdf" }, { id: "8", originalname: "different.pdf" }],
  ]) {
    const result = await confirm(true, true, { "same-name.pdf": ["7", "8"] }, rows);
    assert.equal(result.response.statusCode, 403);
    assert.equal(result.signed, 0);
    assert.equal(result.calls.length, 0);
    assert.equal(result.deletes.length, 0);
    assert.equal(result.deletedObjects.length, 0);
  }
});

test("valid same-dataset duplicates and multi-filename batch maps retain replacement", async () => {
  const result = await confirm(true, true, { "same-name.pdf": ["7", "8"], "other.pdf": ["9"] }, [
    { id: "7", originalname: "same-name.pdf" }, { id: "8", originalname: "same-name.pdf" },
    { id: "9", originalname: "other.pdf" },
  ]);
  assert.equal(result.response.statusCode, 200);
  assert.match(result.calls[0], /\/files\/replace$/);
  assert.equal(result.deletes.length, 2);
  for (const deletion of result.deletes) {
    assert.match(deletion.sql, /dataset_id = \$2/);
    assert.match(deletion.sql, /originalname = \$3/);
    assert.deepEqual(Array.from(deletion.params), ["8", "fixture", "same-name.pdf"]);
  }
  assert.deepEqual(result.deletedObjects, ["old-object"]);
});

test("malformed or repeated replacement IDs fail closed before signing", async () => {
  for (const map of [[], "bad", { "same-name.pdf": "7" }, { "same-name.pdf": ["7", "7"] },
    { "same-name.pdf": [0] }, { "same-name.pdf": [1.5] }, { "same-name.pdf": ["1e2"] },
    { "same-name.pdf": [2147483648] }]) {
    const result = await confirm(true, true, map);
    assert.equal(result.response.statusCode, 400);
    assert.equal(result.signed, 0);
    assert.equal(result.calls.length, 0);
  }
});

test("a failed primary replacement never deletes secondary files or objects", async () => {
  const result = await confirm(true, true, { "same-name.pdf": ["7", "8"] }, [
    { id: "7", originalname: "same-name.pdf" }, { id: "8", originalname: "same-name.pdf" },
  ], false);
  assert.equal(result.response.statusCode, 500);
  assert.equal(result.calls.length, 1);
  assert.equal(result.deletes.length, 0);
  assert.equal(result.deletedObjects.length, 0);
});
