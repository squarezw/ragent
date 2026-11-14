/** biome-ignore-all lint/suspicious/noExplicitAny: VM test harness models heterogeneous React and HTTP interfaces. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as cancellation from "../lib/qaCancellation.ts";
import * as attachments from "../lib/sessionAttachments.ts";
import { workspaceRoutePolicy } from "../lib/workspaceRoutePolicy.ts";
function load(fetcher: typeof fetch) {
  const module = { exports: {} as Record<string, (...args: any[]) => Promise<any>> };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL("../lib/chatTurnsProxy.ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (name: string) =>
        ({
          "@/lib/auth": { getUserIdFromRequest: (req: any) => req.user },
          "@/lib/qaCancellation": cancellation,
          "@/lib/sessionAttachments": attachments,
        })[name],
      fetch: fetcher,
      process: { env: { EXTERNAL_API_BASE_URL: "http://isolated.invalid" } },
      URLSearchParams,
      AbortController,
      Buffer,
      setTimeout,
      clearTimeout,
    }
  );
  return module.exports;
}
function response() {
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writableFinished: false,
    headersSent: false,
    code: 0,
    body: null as any,
    headers: {} as Record<string, any>,
    writes: [] as Buffer[],
    setHeader(key: string, value: any) {
      this.headers[key] = value;
    },
    status(code: number) {
      this.code = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
    flushHeaders() {
      this.headersSent = true;
    },
    write(chunk: Buffer) {
      this.writes.push(chunk);
      return true;
    },
    end() {
      this.writableEnded = true;
      this.writableFinished = true;
    },
  });
  return res;
}
const request = (patch: Record<string, unknown> = {}) =>
  Object.assign(new EventEmitter(), {
    user: 7,
    method: "GET",
    query: { id: "r1" },
    headers: { authorization: "Bearer test", "x-workspace-tenant-id": "3" },
    body: {},
    ...patch,
  });
test("turn control proxy authenticates workspace, allows only fixed paths and no cache", async () => {
  const calls: any[] = [];
  const proxy = load(async (url, options) => {
    calls.push({ url, options });
    return Response.json({ items: [] });
  });
  for (const [patch, code] of [
    [{ user: null }, 401],
    [{ headers: { authorization: "Bearer test" } }, 409],
    [{ method: "POST" }, 405],
  ] as const) {
    const res = response();
    await proxy.proxyChatTurn(request(patch), res, "current");
    assert.equal(res.code, code);
  }
  assert.equal(calls.length, 0);
  const res = response();
  await proxy.proxyChatTurn(
    request({ query: { client_request_id: "lost", region: "forbidden" } }),
    res,
    "current"
  );
  assert.equal(res.headers["Cache-Control"], "private, no-store");
  assert.equal(
    calls[0].url,
    "http://isolated.invalid/api/v1/chat/turns/current?client_request_id=lost"
  );
  assert.equal(calls[0].options.headers["X-Workspace-Tenant-ID"], "3");
  for (const path of [
    "/api/chat/turns",
    "/api/chat/turns/current",
    "/api/chat/turns/r1",
    "/api/chat/turns/r1/events",
    "/api/chat/turns/r1/stop",
  ])
    assert.equal(workspaceRoutePolicy(path), "covered");
});
test("start admission survives browser abort and preserves receipts/idempotency without raw preview fields", async () => {
  let captured: any;
  let release!: (response: Response) => void;
  const proxy = load(async (url, options) => {
    captured = { url, options };
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  const req = request({
    method: "POST",
    body: {
      question: "read upload",
      client_request_id: "stable",
      chat_id: "11",
      datasetId: ["d"],
      attachments: [
        {
          filename: "x.pdf",
          objectKey: "uploads/x",
          uploadReceipt: "signed-proof",
          type: "PDF",
          url: "private-preview",
        },
      ],
    },
  });
  const res = response();
  const pending = proxy.proxyChatTurn(req, res, "start");
  req.emit("aborted");
  assert.equal(captured.options.signal.aborted, false);
  release(Response.json({ run_id: "r1" }));
  await pending;
  const body = JSON.parse(captured.options.body);
  assert.equal(body.client_request_id, "stable");
  assert.equal(body.messages.at(-1).content, "read upload");
  assert.match(body.messages[0].content, /x.pdf/);
  assert.deepEqual(body.dataset_id, ["d"]);
  assert.equal(body.attachments[0].upload_receipt, "signed-proof");
  assert.equal(body.attachments[0].url, undefined);
});
test("subscription disconnect cancels transport only and never calls stop", async () => {
  const calls: string[] = [];
  let signal: AbortSignal | undefined;
  let cancelled = false;
  const proxy = load(async (url, options) => {
    calls.push(String(url));
    signal = options?.signal as AbortSignal;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(": ping\n\n"));
        },
        cancel() {
          cancelled = true;
        },
      })
    );
  });
  const req = request({ query: { id: "r1", after: "5" } });
  const res = response();
  res.write = function (chunk: Buffer) {
    this.writes.push(chunk);
    this.destroyed = true;
    this.emit("close");
    return true;
  };
  await proxy.proxyChatTurn(req, res, "events");
  assert.equal(signal?.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /events\?after=5$/);
});
test("slow subscriber drain wait releases on abort and removes listeners", async () => {
  const proxy = load(fetch);
  const res = response();
  res.write = () => false;
  const controller = new AbortController();
  let done = false;
  const pending = proxy.writeChatRunChunk(res, new Uint8Array([1]), controller.signal).then(() => {
    done = true;
  });
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(res.listenerCount("drain"), 1);
  controller.abort();
  await pending;
  assert.equal(done, true);
  assert.equal(res.listenerCount("drain"), 0);
  assert.equal(res.listenerCount("close"), 0);
});
