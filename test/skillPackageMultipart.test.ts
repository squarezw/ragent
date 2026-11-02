import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";
import { readFileSync } from "node:fs";
function harness() {
  const calls: any[] = [];
  const module = { exports: {} as any };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL("../lib/skillsProxy.ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      module,
      exports: module.exports,
      process: { env: {  } },
      URLSearchParams,
      console,
      Buffer,
      require: (name: string) =>
        name === "axios"
          ? {
              default: {
                request: async (options: any) => {
                  calls.push(options);
                  return { status: 200, data: { ok: true } };
                },
                isAxiosError: () => false,
              },
            }
          : { getUserIdFromRequest: () => 7 },
    }
  );
  let code = 0;
  let body: any;
  const res = {
    setHeader() {},
    status: (value: number) => {
      code = value;
      return res;
    },
    json: (value: any) => {
      body = value;
      return res;
    },
  };
  return { calls, proxy: module.exports.proxySkillsApi, res, status: () => code, body: () => body };
}
const req = () => ({
  async *[Symbol.asyncIterator]() {
    yield Buffer.from("fixture multipart bytes");
  },
  method: "POST",
  headers: {
    authorization: "Bearer fixture",
    "content-type": "multipart/form-data; boundary=fixture",
    "x-workspace-tenant-id": "1",
  },
  query: {},
  body: undefined,
});
test("multipart preserves original stream/boundary/auth/source workspace with finite cap", async () => {
  const h = harness(),
    r = req();
  await h.proxy(r, h.res, {
    path: "/api/v1/skills/9/package-replacement",
    allow: ["POST"],
    multipartBody: true,
  });
  assert.equal(h.calls.length, 1);
  const call = h.calls[0];
  assert.equal(Buffer.isBuffer(call.data), true);
  assert.equal(call.data.toString(), "fixture multipart bytes");
  assert.equal(call.headers["Content-Type"], r.headers["content-type"]);
  assert.equal(call.headers["X-Workspace-Tenant-ID"], "1");
  assert.equal(call.headers.Authorization, "Bearer fixture");
  assert.equal(call.maxBodyLength, 26 * 1024 * 1024);
  assert.equal(call.transformRequest[0](call.data), call.data);
});
test("invalid multipart, oversized body and missing workspace never forward upload", async () => {
  for (const [headers, status] of [
    [{ "content-type": "application/json" }, 415],
    [{ "content-length": String(161 * 1024 * 1024) }, 413],
    [{ "x-workspace-tenant-id": undefined }, 409],
  ] as any[]) {
    const h = harness(),
      r = req();
    Object.assign(r.headers, headers);
    await h.proxy(r, h.res, {
      path: "/api/v1/skills/9/package-replacement",
      allow: ["POST"],
      multipartBody: true,
    });
    assert.equal(h.status(), status);
    assert.equal(h.calls.length, 0);
  }
});

test("actual chunk budget rejects absent and forged Content-Length before any forwarding", async () => {
  for (const length of [undefined, "1"]) {
    const h = harness(),
      r = req();
    Object.assign(r.headers, { "content-length": length });
    r[Symbol.asyncIterator] = async function* () {
      yield Buffer.alloc(13 * 1024 * 1024);
      yield Buffer.alloc(13 * 1024 * 1024 + 1);
    };
    await h.proxy(r, h.res, {
      path: "/api/v1/skills/9/package-replacement",
      allow: ["POST"],
      multipartBody: true,
    });
    assert.equal(h.status(), 413);
    assert.equal(h.calls.length, 0);
  }
});
