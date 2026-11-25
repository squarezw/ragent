import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as preview from "../lib/chatResourcePreview.ts";
import { workspaceRoutePolicy } from "../lib/workspaceRoutePolicy.ts";

const id = "7b401346-eacf-458d-9dd9-1d39e744bae4";
const path = `/api/chat/sessions/4/artifacts/${id}/download`;

function load(file: string, dependencies: Record<string, unknown>, globals = {}) {
  const module = { exports: {} as any };
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: (name: string) => dependencies[name], URL, AbortSignal, ...globals });
  return module.exports;
}

function harness(upstream: Response, authorized = true) {
  const calls: { url: URL; options: RequestInit }[] = [];
  const res = {
    code: 200, headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { this.headers[key] = value; },
    status(code: number) { this.code = code; return this; },
    end() {},
  };
  const resolver = load("../lib/chatArtifactRedirect.ts", {
    "@/lib/chatResourcePreview": preview,
    "@/lib/auth": { getTokenFromRequest: () => "actor-token" },
    "@/lib/workspaceTenant": { requireWorkspaceTenant: async () => {
      if (authorized) return { tenantId: 5 };
      res.status(403).end();
      return null;
    } },
  }, {
    process: { env: { EXTERNAL_API_BASE_URL: "https://backend.example" } },
    fetch: async (url: URL, options: RequestInit) => { calls.push({ url, options }); return upstream; },
  });
  const handler = load("../pages/api/chat/sessions/[id]/artifacts/[artifactId]/download.ts", {
    "@/lib/chatArtifactRedirect": resolver,
  }).default;
  return { calls, res, run: (artifactId = id) => handler({ method: "GET", query: { id: "4", artifactId, filename: "显示名.pdf" } }, res) };
}

test("stable download authenticates with the workspace, strips display metadata and returns a fresh redirect", async () => {
  const signed = "https://storage.example/object?signature=test";
  const h = harness(Response.redirect(signed, 307));
  await h.run();
  assert.equal(workspaceRoutePolicy(path), "covered");
  assert.equal(h.calls.length, 1);
  const { url, options } = h.calls[0];
  assert.equal(url.href, "https://backend.example" + path.replace("/api/", "/api/v1/"));
  assert.equal(options.redirect, "manual");
  assert.equal(options.cache, "no-store");
  assert.equal(new Headers(options.headers).get("authorization"), "Bearer actor-token");
  assert.equal(new Headers(options.headers).get("x-workspace-tenant-id"), "5");
  assert.equal(h.res.code, 307);
  assert.equal(h.res.headers.Location, signed);
  assert.equal(h.res.headers["Cache-Control"], "private, no-store");
});

test("denied workspaces, malformed paths, upstream failures and invalid redirects disclose no location", async () => {
  for (const [status, location, expected] of [[404, "", 404], [403, "", 403], [500, "", 502], [307, "data:text/plain,x", 502], [200, "", 502]] as const) {
    const h = harness(new Response("private diagnostic", { status, headers: { location } }));
    await h.run();
    assert.equal(h.res.code, expected);
    assert.equal(h.res.headers.Location, undefined);
  }
  for (const [authorized, artifactId, status] of [[false, id, 403], [true, "../x", 400], [true, id + "?x", 400]] as const) {
    const h = harness(new Response(), authorized);
    await h.run(artifactId);
    assert.equal(h.res.code, status);
    assert.equal(h.calls.length, 0);
  }
});

test("stable Markdown links resolve the display filename for previews and downloads", () => {
  for (const [extension, kind] of [["mp4", "video"], ["wav", "audio"], ["dxf", "dxf"], ["html", "url"], ["png", "image"], ["pdf", undefined]] as const) {
    const url = path + "?filename=" + encodeURIComponent("交付物." + extension);
    assert.equal(preview.toPreviewResource("url", url)?.kind, kind);
    assert.equal(preview.isChatDownloadOnly(url), !kind);
  }
});

for (const [route, filename, mime] of [["preview-artifact", "demo.html", "text/html; charset=utf-8"], ["preview-dxf", "part.dxf", "application/octet-stream"]]) {
  test(`${route} reads session-authorized bytes without forwarding the actor token to storage`, async () => {
    const data = Buffer.from("generated artifact");
    const url = path + "?filename=" + filename;
    let resolved = 0;
    const handler = load(`../pages/api/chat/${route}.ts`, {
      "@/lib/chatResourcePreview": preview,
      "@/lib/auth": { requireAuth: () => true },
      "@/lib/ossClient": {},
      "@/lib/chatArtifactRedirect": { resolveChatArtifact: async (_req: unknown, _res: unknown, raw: string) => {
        assert.equal(raw, url);
        resolved++;
        return new URL("https://storage.example/artifact");
      } },
    }, { Buffer, fetch: async (_url: URL, options: RequestInit) => {
      assert.equal(new Headers(options.headers).has("authorization"), false);
      assert.equal(options.redirect, "error");
      return new Response(data);
    } });
    const res = {
      headers: {} as Record<string, string>,
      setHeader(key: string, value: string) { this.headers[key] = value; },
      status(code: number) { assert.equal(code, 200); return this; },
      send(body: Buffer) { assert.deepEqual(body, data); },
    };
    await handler.default({ method: "GET", query: { url } }, res);
    assert.equal(resolved, 1);
    assert.equal(res.headers["Content-Type"], mime);
    assert.match(res.headers["Content-Security-Policy"], /sandbox/);
    assert.equal(res.headers["Cache-Control"], "private, no-store");
  });
}
