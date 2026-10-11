import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import * as sessionAttachments from "../lib/sessionAttachments.ts";
import * as cancellation from "../lib/qaCancellation.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function loadProduction(path: string, imports: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const module = { exports: {} as Record<string, any> };
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name: string) => {
      assert.ok(name in imports, `unexpected import ${name}`);
      return imports[name];
    },
    fetch,
    TextDecoder,
    console: { log() {}, error() {}, warn() {} },
    process,
    ...overrides,
  });
  return module.exports;
}

test("actual QA route and core propagate stop to backend without SSE errors", {
  timeout: 5000,
}, async () => {
  let backendClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    backendClosed = resolve;
  });
  const backend = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: first\n\n");
    res.on("close", backendClosed);
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const backendAddress = backend.address();
  assert.ok(backendAddress && typeof backendAddress !== "string");
  const previous = process.env.EXTERNAL_API_BASE_URL;
  process.env.EXTERNAL_API_BASE_URL = `http://127.0.0.1:${backendAddress.port}`;
  const core = loadProduction("../lib/qaCore.ts", {
    "@/lib/axios": {},
    "@/lib/sessionAttachments": sessionAttachments,
    "@/lib/qaCancellation": cancellation,
  });
  let logs = 0;
  const route = loadProduction("../pages/api/chat/qa.ts", {
    "@/lib/auth": { requireAuth: () => true },
    "@/lib/qaCore": core,
    "@/lib/qaCancellation": cancellation,
    "@/lib/logError": { logError: () => logs++ },
  });
  let finished!: () => void;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const proxy = createServer(async (req, res) => {
    const enriched = Object.assign(req, {
      body: { question: "controlled question", stream: true },
      method: "POST",
    });
    try {
      await route.default(enriched, res);
    } finally {
      finished();
    }
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const proxyAddress = proxy.address();
  assert.ok(proxyAddress && typeof proxyAddress !== "string");
  try {
    await new Promise<void>((resolve, reject) => {
      const client = request(`http://127.0.0.1:${proxyAddress.port}`, { method: "POST" }, (res) => {
        res.once("data", () => {
          res.destroy();
          client.destroy();
          resolve();
        });
      });
      client.on("error", reject);
      client.end("body complete before disconnect");
    });
    await Promise.all([done, closed]);
    assert.equal(logs, 0);
  } finally {
    if (previous === undefined) delete process.env.EXTERNAL_API_BASE_URL;
    else process.env.EXTERNAL_API_BASE_URL = previous;
    proxy.closeAllConnections();
    backend.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => backend.close(() => resolve())),
    ]);
  }
});

for (const status of [403, 413, 422, 503]) {
  test(`streaming backend ${status} preserves its safe detail and status`, async () => {
    const detail = "图片上传凭证无效或已过期，请重新上传图片";
    const core = loadProduction("../lib/qaCore.ts", {
      "@/lib/axios": {},
      "@/lib/qaCancellation": cancellation,
      "@/lib/sessionAttachments": sessionAttachments,
    }, { fetch: async () => new Response(JSON.stringify({ detail }), { status }) });
    await assert.rejects(core.runQA({ question: "inspect" }, undefined, undefined, {}),
      (error: any) => error.message === detail && error.statusCode === status);
    let captured: any;
    await core.runQA({ question: "inspect" }, undefined, {
      onChunk() {}, onComplete() {}, onError(error: any) { captured = error; },
    });
    assert.equal(captured.message, detail);
    assert.equal(captured.statusCode, status);
  });
}
