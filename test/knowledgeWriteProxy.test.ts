import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const body = {
  request_id: "a".repeat(32),
  dataset_id: "550e8400-e29b-41d4-a716-446655440000",
  chat_id: "42",
};
async function invoke(input: any = body, failure?: any) {
  const calls: any[] = [];
  const api: any = {};
  const source = readFileSync(
    new URL("../pages/api/knowledge/write-selection.ts", import.meta.url),
    "utf8"
  );
  runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      exports: api,
      process: { env: {} },
      require: (name: string) => {
        if (name === "axios")
          return {
            default: {
              post: async (...args: any[]) => {
                calls.push(args);
                if (failure) throw failure;
                return {
                  data: {
                    status: "processing",
                    file_id: 9,
                    task_id: "task",
                    object_key: "PRIVATE",
                  },
                };
              },
              isAxiosError: (error: any) => !!error.response,
            },
          };
        if (name === "@/lib/workspaceTenant")
          return {
            workspaceHeaders: (req: any) => ({
              "X-Workspace-Tenant-ID": req.headers["x-workspace-tenant-id"],
            }),
          };
        if (name === "@/lib/workspaceKnowledge") return { withKnowledgeWorkspace: (fn: any) => fn };
        throw Error(name);
      },
    }
  );
  const res: any = {
    code: 0,
    payload: null,
    setHeader() {},
    status(code: number) {
      this.code = code;
      return this;
    },
    json(payload: any) {
      this.payload = payload;
      return this;
    },
  };
  await api.default(
    {
      method: "POST",
      body: input,
      headers: { authorization: "Bearer trusted", "x-workspace-tenant-id": "7" },
    },
    res
  );
  return { calls, res };
}
test("proxy forwards authentication and workspace, never client actor or source", async () => {
  const { calls, res } = await invoke({
    ...body,
    user_id: 999,
    owner_tenant_id: 888,
    confirmed: true,
    object_key: "PRIVATE",
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    dataset_id: body.dataset_id,
    chat_id: "42",
  });
  assert.equal(calls[0][2].headers.Authorization, "Bearer trusted");
  assert.equal(calls[0][2].headers["X-Workspace-Tenant-ID"], "7");
  assert.equal(calls[0][2].maxRedirects, 0);
  assert.ok(
    calls[0][2].timeout > (60 + 120) * 1000,
    "confirmation must allow bounded document download and upload"
  );
  assert.equal(res.code, 200);
  assert.equal(JSON.stringify(res.payload).includes("PRIVATE"), false);
});
test("invalid selection never reaches backend and upstream errors remain generic", async () => {
  assert.equal((await invoke({ ...body, request_id: "../admin" })).calls.length, 0);
  const { res } = await invoke(body, {
    response: { status: 403, data: { detail: "PRIVATE TOKEN" } },
  });
  assert.equal(res.code, 403);
  assert.equal(JSON.stringify(res.payload).includes("PRIVATE"), false);
});
