import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
function harness(fetcher: typeof fetch, existingWindow?: { fetch: typeof fetch; location: { origin: string } }) {
  const source = fs.readFileSync(new URL("../lib/workspaceBrowser.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  const window = existingWindow || { fetch: fetcher, location: { origin: "http://localhost" } };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    window,
    URL,
    Request,
    Response,
    Headers,
    ReadableStream,
    AbortController,
    DOMException,
  });
  const api = module.exports;
  api.setWorkspaceOperation(true, 1, 10);
  api.installWorkspaceFetch();
  return { api, window };
}
test("slow JSON body is rejected after workspace changes even after headers arrive", async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const h = harness(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            body = c;
          },
        }),
        { headers: { "content-type": "application/json" } }
      )
  );
  const response = await h.window.fetch("http://localhost/api/example");
  const reading = response.json();
  h.api.setWorkspaceOperation(true, 1, 20);
  body.enqueue(new TextEncoder().encode('{"tenant":10}'));
  body.close();
  await assert.rejects(reading, { name: "AbortError" });
});
test("already buffered bodies and their clones cannot be decoded in the next workspace", async () => {
  const h = harness(
    async () =>
      new Response(JSON.stringify({ tenant: 10 }), {
        headers: { "content-type": "application/json" },
      })
  );
  const response = await h.window.fetch("http://localhost/api/example");
  const cloned = response.clone();
  h.api.setWorkspaceOperation(true, 1, 20);
  await assert.rejects(response.json(), { name: "AbortError" });
  await assert.rejects(cloned.text(), { name: "AbortError" });
});
test("completed non-streaming writes release the switch barrier while JSON remains readable", async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const h = harness(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            body = c;
          },
        })
      )
  );
  const response = await h.window.fetch("http://localhost/api/example", { method: "POST" });
  assert.equal(h.api.workspaceBusy(), false);
  const reading = response.json();
  body.enqueue(new TextEncoder().encode('{"ok":true}'));
  body.close();
  assert.deepEqual(await reading, { ok: true });
  assert.equal(h.api.workspaceBusy(), false);
});

test("SSE writes remain busy until consumed", async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const h = harness(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            body = c;
          },
        }),
        { headers: { "content-type": "text/event-stream" } }
      )
  );
  const response = await h.window.fetch("http://localhost/api/chat", { method: "POST" });
  assert.equal(h.api.workspaceBusy(), true);
  const reading = response.text();
  body.close();
  assert.equal(await reading, "");
  assert.equal(h.api.workspaceBusy(), false);
});

test("identity reset clears an unread aborted SSE write barrier", async () => {
  const h = harness(async () => new Response(new ReadableStream({start() {}}), {headers:{"content-type":"text/event-stream"}}));
  const response = await h.window.fetch("http://localhost/api/chat", {method:"POST"});
  assert.equal(h.api.workspaceBusy(), true);
  h.api.setWorkspaceOperation(true, 2, null);
  assert.equal(h.api.workspaceBusy(), false);
  await response.body!.cancel();
  assert.equal(h.api.workspaceBusy(), false);
});

test("guarded responses preserve source metadata and clone metadata", async () => {
  const source = new Response("ok");
  Object.defineProperties(source, { url:{value:"http://localhost/api/target"},redirected:{value:true} });
  const h=harness(async()=>source);const response=await h.window.fetch("http://localhost/api/example");
  assert.equal(response.url,source.url);assert.equal(response.redirected,true);
  const cloned=response.clone();assert.equal(cloned.url,source.url);assert.equal(cloned.redirected,true);
  assert.equal(await response.text(),"ok");assert.equal(await cloned.text(),"ok");
});

test("workspace fetch bypasses cache entries left by the legacy API", async () => {
  let cache: RequestCache | undefined;
  const h=harness(async(_input,init)=>{cache=init?.cache;return new Response("ok");});
  const response=await h.window.fetch("http://localhost/api/example");
  assert.equal(cache,"no-store");assert.equal(await response.text(),"ok");
});

test("native links scope same-origin absolute API URLs without changing external signed URLs", () => {
  const h=harness(async()=>new Response());
  assert.equal(h.api.workspaceUrl("http://localhost/api/uploads/a.pdf?file_id=3"),"http://localhost/api/uploads/a.pdf?file_id=3&workspace_tenant_id=10");
  assert.equal(h.api.workspaceUrl("/api/chat/preview-artifact?url=original"),"/api/chat/preview-artifact?url=original&workspace_tenant_id=10");
  const external="https://files.example/api/object?signature=secret-placeholder";
  assert.equal(h.api.workspaceUrl(external),external);
});

// Next development HMR can reload this module without restoring the old fetch wrapper.
test("reinstalled fetch guards accept logout 204 and HEAD responses with no body", async () => {
  for (const [method, status] of [["POST", 204], ["HEAD", 200]] as const) {
    const first = harness(async () => new Response(null, { status }));
    harness(first.window.fetch, first.window);
    const response = await first.window.fetch("http://localhost/api/auth/logout", { method });
    assert.equal(response.status, status);
    assert.equal(response.body, null);
    assert.equal(await response.text(), "");
    assert.equal(await response.clone().text(), "");
  }
});

test("reinstalled guards and clones use only the current module generation", async () => {
  for (const changed of ["retired", "current"] as const) {
    const first = harness(async () => new Response(null, { status: 204 }));
    const second = harness(first.window.fetch, first.window);
    const response = await first.window.fetch("http://localhost/api/auth/logout", { method: "POST" });
    const clone = response.clone();
    (changed === "retired" ? first.api : second.api).setWorkspaceOperation(true, 1, 20);
    if (changed === "current") {
      await assert.rejects(response.text(), { name: "AbortError" });
      await assert.rejects(clone.text(), { name: "AbortError" });
    } else {
      assert.equal(await response.text(), "");
      assert.equal(await clone.text(), "");
    }
  }
});

test("reinstalled guards retain current JSON protection without stale module interference", async () => {
  for (const changed of ["retired", "current"] as const) {
    const first = harness(async () => new Response(JSON.stringify({ tenant: 10 }), { headers: { "content-type": "application/json" } }));
    const second = harness(first.window.fetch, first.window);
    const response = await first.window.fetch("http://localhost/api/example");
    const clone = response.clone();
    (changed === "retired" ? first.api : second.api).setWorkspaceOperation(true, 1, 20);
    if (changed === "current") {
      await assert.rejects(response.json(), { name: "AbortError" });
      await assert.rejects(clone.json(), { name: "AbortError" });
    } else {
      assert.deepEqual(await response.json(), { tenant: 10 });
      assert.deepEqual(await clone.json(), { tenant: 10 });
    }
  }
});

test("null-body statuses and HEAD discard browser wrapper streams without waiting for cancellation", async () => {
  for (const [method, status] of [["POST", 204], ["POST", 205], ["GET", 304], ["HEAD", 200]] as const) {
    let canceled = 0;
    const stream = new ReadableStream({ cancel() { canceled++; return new Promise(() => {}); } });
    const source = new Response(stream, { headers: { "content-type": "text/event-stream" } });
    Object.defineProperty(source, "status", { value: status });
    Object.defineProperty(source, "statusText", { value: "" });
    const first = harness(async () => source);
    harness(first.window.fetch, first.window);
    const response = await first.window.fetch("http://localhost/api/auth/logout", { method });
    assert.equal(response.status, status);
    assert.equal(response.body, null);
    assert.equal(await response.text(), "");
    assert.equal(await response.clone().text(), "");
    assert.equal(canceled, 1);
    assert.equal(first.api.workspaceBusy(), false);
  }
});

test("null-body normalization handles rejected stream cancellation and keeps stale guards", async () => {
  const source = new Response(new ReadableStream({ cancel() { return Promise.reject(new Error("fixture cancellation failed")); } }));
  Object.defineProperty(source, "status", { value: 204 });
  const first = harness(async () => source);
  const response = await first.window.fetch("http://localhost/api/auth/logout", { method: "POST" });
  const clone = response.clone();
  first.api.setWorkspaceOperation(true, 1, 20);
  await assert.rejects(response.text(), { name: "AbortError" });
  await assert.rejects(clone.text(), { name: "AbortError" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(first.api.workspaceBusy(), false);
});

test("HMR replacement sends the new tenant header and aborts retired pending requests", async () => {
  let capturedTenant: string | null = null;
  let oldSignal: AbortSignal | undefined;
  let release!: (response: Response) => void;
  let pending = true;
  const first = harness(async (_url, init) => {
    if (pending) {
      oldSignal = init?.signal as AbortSignal;
      return new Promise(resolve => { release = resolve; });
    }
    capturedTenant = new Headers(init?.headers).get("X-Workspace-Tenant-ID");
    return new Response(null, { status: 204 });
  });
  const oldRequest = first.window.fetch("http://localhost/api/example");
  const oldRejected = assert.rejects(oldRequest, { name: "AbortError" });
  const second = harness(first.window.fetch, first.window);
  second.api.setWorkspaceOperation(true, 1, 20);
  assert.equal(oldSignal?.aborted, true);
  release(new Response("old"));
  await oldRejected;
  pending = false;
  const response = await first.window.fetch("http://localhost/api/example", { method: "POST" });
  assert.equal(response.status, 204);
  assert.equal(capturedTenant, "20");
  assert.equal(first.api.workspaceBusy(), false);
  assert.equal(second.api.workspaceBusy(), false);
});

test("HMR replacement invalidates retired buffered responses and clones", async () => {
  const first = harness(async () => new Response(JSON.stringify({ tenant: 10 })));
  const old = await first.window.fetch("http://localhost/api/example");
  const clone = old.clone();
  harness(first.window.fetch, first.window);
  await assert.rejects(old.json(), { name: "AbortError" });
  await assert.rejects(clone.json(), { name: "AbortError" });
});
