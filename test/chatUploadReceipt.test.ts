import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { signChatUploadReceipt } from "../lib/chatUploadReceipt.ts";
import { chatAttachmentPayload, normalizeSessionAttachments } from "../lib/sessionAttachments.ts";

const secret = "offline-upload-receipt-test-key-only";
test("receipt binds the server-returned key to a user and dedicated scope", () => {
  const token = signChatUploadReceipt(7, "attachments/new.png", "image/png", secret);
  const claims = jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer: "ragent-upload",
    audience: "ragent-chat-image",
  });
  assert.ok(typeof claims === "object");
  assert.equal(claims.sub, "7");
  assert.equal(claims.object_key, "attachments/new.png");
  assert.equal(claims.purpose, "chat_image");
  assert.equal(claims.content_type, "image/png");
  assert.equal(claims.v, 1);
  assert.equal(claims.exp! - claims.iat!, 7200);
  assert.equal(claims.userId, undefined);
  assert.throws(() => jwt.verify(token, secret, { audience: "login" }));
  assert.throws(() => jwt.verify(token, "wrong-key"));
});

test("current-turn payload keeps real MIME and proof, never preview URLs", () => {
  const payload = chatAttachmentPayload([
    {
      objectKey: "attachments/new.png",
      filename: "new.png",
      type: "Image",
      contentType: "image/png",
      uploadReceipt: "proof",
      size: 20,
    },
    { objectKey: "attachments/old.jpg", filename: "old.jpg", type: "Image" },
    { filename: "no-key.png" },
  ]);
  assert.equal(payload.length, 2);
  assert.equal(payload[0].content_type, "image/png");
  assert.equal(payload[0].upload_receipt, "proof");
  assert.equal(payload[1].content_type, "image/jpeg");
  assert.equal(payload[1].upload_receipt, undefined);
  assert.equal(payload[0].object_key, "attachments/new.png");
});

test("history normalization does not retain or invent upload proofs", () => {
  const restored = normalizeSessionAttachments([
    { object_key: "attachments/a.png", filename: "a.png", upload_receipt: "proof" },
  ]);
  assert.equal(chatAttachmentPayload(restored)[0].upload_receipt, undefined);
});

test("authenticated presign signs only the storage service's returned key", async () => {
  const { createRequire } = await import("node:module");
  const { readFileSync } = await import("node:fs");
  const { runInNewContext } = await import("node:vm");
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const module = { exports: {} as Record<string, any> };
  let userId: number | null = 7;
  let storageCalls = 0;
  const imports: Record<string, unknown> = {
    "@/lib/auth": { getUserIdFromRequest: () => userId },
    "@/lib/env": { requireEnv: () => secret },
    "@/lib/chatUploadReceipt": { signChatUploadReceipt },
    "@/lib/ossClient": {
      ossClient: {
        presign: async () => {
          storageCalls++;
          return {
            objectKey: "attachments/server-returned.png",
            uploadUrl: "https://offline.invalid/put",
            headers: {},
          };
        },
      },
    },
  };
  const compiled = ts.transpileModule(
    readFileSync(new URL("../pages/api/oss/presign.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }
  ).outputText;
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name: string) => {
      assert.ok(name in imports, `unexpected import ${name}`);
      return imports[name];
    },
    console,
  });
  let status = 0;
  let body: any;
  const res = {
    status(value: number) {
      status = value;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  };
  const req = {
    method: "POST",
    body: {
      filename: "new.png",
      contentType: "image/png",
      category: "attachments",
      objectKey: "other-users/key",
    },
  };
  await module.exports.default(req, res);
  assert.equal(status, 200);
  const claims = jwt.verify(body.uploadReceipt, secret, {
    audience: "ragent-chat-image",
  }) as jwt.JwtPayload;
  assert.equal(claims.object_key, "attachments/server-returned.png");
  assert.equal(claims.sub, "7");
  assert.equal(storageCalls, 1);
  userId = null;
  await module.exports.default(req, res);
  assert.equal(status, 401);
  assert.equal(storageCalls, 1);
  userId = 7;
  req.body.category = "knowledge";
  await module.exports.default(req, res);
  assert.equal(body.uploadReceipt, undefined);
});
