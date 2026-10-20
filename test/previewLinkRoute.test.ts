import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import jwt from "jsonwebtoken";
import { createDirectPreviewResolver } from "../lib/directPreviewLink.ts";
import { createPreviewLink, previewRevision } from "../lib/previewLinkPolicy.ts";

const secret = "offline-preview-route-test-secret";
interface MockResponse {
  status(value: number): MockResponse;
  json(value: Record<string, unknown>): MockResponse;
}
interface MockRequest {
  method: string;
  body: { fileId: number; previousToken: string };
}
function tokenFrom(url: string): string {
  const token = new URL(url, "http://offline.invalid").searchParams.get("token");
  assert.ok(token);
  return token;
}

const require = createRequire(import.meta.url);
const ts = require("typescript");

test("preview renewal authenticates and checks live dataset access before accepting any candidate", async () => {
  let userId: number | null = 7;
  let rows: unknown[] = [
    {
      object_key: "key.pdf",
      mimetype: "application/pdf",
      size: 42,
      upload_time: "2026-10-20",
      filename: "example.pdf",
    },
  ];
  let signCalls = 0;
  let signingEnabled = false;
  let queries = 0;
  let releases = 0;
  const module = {
    exports: {} as Record<string, (req: MockRequest, res: MockResponse) => Promise<unknown>>,
  };
  const imports: Record<string, unknown> = {
    "@/lib/auth": {
      requireAuth: (_req: unknown, res: MockResponse) => {
        if (!userId) {
          res.status(401).json({ error: "unauthorized" });
          return false;
        }
        return true;
      },
      getUserIdFromRequest: () => userId,
    },
    "@/lib/db": {
      default: {
        connect: async () => ({
          query: async (sql: string, args: unknown[]) => {
            queries++;
            assert.match(sql, /can_access_dataset\(\$2, dataset_id\)/);
            assert.match(sql, /status <> 'deleted'/);
            assert.deepEqual(Array.from(args), ["2", userId]);
            return { rows };
          },
          release: () => {
            releases++;
          },
        }),
      },
    },
    "@/lib/previewLinkPolicy": { createPreviewLink, previewRevision },
    "@/lib/directPreviewLink": {
      resolveDirectPreviewLink: createDirectPreviewResolver(200, async () => true),
    },
    "@/lib/ossClient": {
      ossClient: {
        sign: async (request: any) => {
          signCalls++;
          if (!signingEnabled) throw new Error("offline gateway");
          const url = new URL("https://bucket.example/test.pdf");
          url.searchParams.set("X-Amz-Signature", "offline");
          url.searchParams.set(
            "X-Amz-Date",
            new Date()
              .toISOString()
              .replace(/[-:]/g, "")
              .replace(/\.\d{3}/, "")
          );
          url.searchParams.set("X-Amz-Expires", String(request.expiresIn));
          url.searchParams.set("response-content-disposition", request.responseContentDisposition);
          url.searchParams.set("response-content-type", request.responseContentType);
          return { url: url.toString() };
        },
      },
    },
  };
  const compiled = ts.transpileModule(
    readFileSync(new URL("../pages/api/file-preview/stream-url.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name: string) => {
      assert.ok(name in imports, `unexpected import ${name}`);
      return imports[name];
    },
    process: { env: { PREVIEW_TOKEN_SECRET: secret } },
  });
  let status = 0;
  let body: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status(value: number) {
      status = value;
      return this;
    },
    json(value: Record<string, unknown>) {
      body = value;
      return this;
    },
  };
  const req = { method: "POST", body: { fileId: 2, previousToken: "" } };
  await module.exports.default(req, res);
  assert.equal(status, 200);
  assert.equal(headers["Cache-Control"], "no-store");
  const previous = tokenFrom(String(body.url));
  req.body.previousToken = previous;
  await module.exports.default(req, res);
  assert.equal(
    new URL(String(body.url), "http://offline.invalid").searchParams.get("token"),
    previous
  );
  assert.equal(queries, 2);
  assert.equal(releases, 2);

  // Revocation/deletion (the ACL-filtered query returns no row) cannot be bypassed by a valid token.
  rows = [];
  await module.exports.default(req, res);
  assert.equal(status, 404);
  assert.equal(queries, 3);
  assert.equal(body.url, undefined);
  assert.equal(releases, 3);
  userId = null;
  await module.exports.default(req, res);
  assert.equal(status, 401);
  assert.equal(queries, 3);
  assert.equal(headers["Cache-Control"], "no-store");

  // Returning after account switching generates a token owned by the new authenticated user.
  userId = 8;
  rows = [
    {
      object_key: "key.pdf",
      mimetype: "application/pdf",
      size: 42,
      upload_time: "2026-10-20",
      filename: "example.pdf",
    },
  ];
  await module.exports.default(req, res);
  assert.equal(status, 200);
  const switched = tokenFrom(String(body.url));
  assert.notEqual(switched, previous);
  assert.equal((jwt.verify(switched, secret) as jwt.JwtPayload).userId, 8);

  rows = [
    {
      object_key: "replacement.pdf",
      mimetype: "application/pdf",
      size: 43,
      upload_time: "2026-10-21",
      filename: "example.pdf",
    },
  ];
  req.body.previousToken = switched;
  await module.exports.default(req, res);
  const replaced = tokenFrom(String(body.url));
  assert.notEqual(replaced, switched);
  assert.equal((jwt.verify(replaced, secret) as jwt.JwtPayload).objectKey, "replacement.pdf");
  assert.equal(queries, releases);
  signingEnabled = true;
  await module.exports.default(req, res);
  assert.ok(String(body.url).startsWith("https://"));
  assert.ok(String(body.fallbackUrl).startsWith("/api/file-preview/stream?token="));
  const direct = body.url;
  req.body.previousToken = tokenFrom(String(body.fallbackUrl));
  const callsBeforeReuse = signCalls;
  await module.exports.default(req, res);
  assert.equal(body.url, direct);
  assert.equal(signCalls, callsBeforeReuse);
  rows = [];
  await module.exports.default(req, res);
  assert.equal(status, 404);
  assert.equal(body.url, undefined);
  assert.equal(signCalls, callsBeforeReuse);
  userId = null;
  await module.exports.default(req, res);
  assert.equal(status, 401);
  assert.equal(signCalls, callsBeforeReuse);
});
