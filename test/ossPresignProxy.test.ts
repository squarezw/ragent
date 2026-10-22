import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../pages/api/oss/presign.ts", import.meta.url), "utf8");
const body = { filename: "handbook.pdf", contentType: "application/pdf", category: "attachments" };

async function invoke({ authenticated = true, status = 200, result = {}, unavailable = false, method = "POST" } = {}) {
  const calls: any[] = [];
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, {
    module, exports: module.exports, AbortSignal,
    process: { env: { EXTERNAL_API_BASE_URL: "http://backend.test:8010/" } },
    require: (name: string) => {
      assert.equal(name, "@/lib/auth");
      return {
        getUserIdFromRequest: () => authenticated ? 7 : null,
        getTokenFromRequest: () => authenticated ? "session-token" : null,
      };
    },
    fetch: async (...args: any[]) => {
      calls.push(args);
      if (unavailable) throw Error("connection refused");
      return { ok: status < 400, status, json: async () => result };
    },
  });
  const res: any = {
    code: 0, body: null,
    status(code: number) { this.code = code; return this; },
    json(value: any) { this.body = value; return this; },
  };
  await module.exports.default({ method, body }, res);
  return { res, calls };
}

test("presign forwards the resolved session token and preserves upload headers and receipt", async () => {
  const result = { objectKey: "attachments/handbook.pdf", uploadUrl: "https://oss.test/signed", headers: { "Content-Type": "application/pdf" }, uploadReceipt: "receipt" };
  const { res, calls } = await invoke({ result });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, result);
  assert.equal(calls[0][0], "http://backend.test:8010/api/v1/files/presign");
  assert.equal(calls[0][1].headers.Authorization, "Bearer session-token");
  assert.deepEqual(JSON.parse(calls[0][1].body), body);
});

test("presign rejects anonymous requests before contacting backend", async () => {
  const { res, calls } = await invoke({ authenticated: false });
  assert.equal(res.code, 401);
  assert.equal(calls.length, 0);
});

test("presign preserves backend rejection status", async () => {
  const { res } = await invoke({ status: 403, result: { detail: "Forbidden" } });
  assert.equal(res.code, 403);
  assert.equal(res.body.error, "Forbidden");
});

test("presign handles backend outages without exposing connection details", async () => {
  const { res } = await invoke({ unavailable: true });
  assert.equal(res.code, 502);
  assert.equal(res.body.error, "Upload authorization service unavailable");
});
