import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { createPreviewLink, previewRevision } from "../lib/previewLinkPolicy.ts";

const secret = "offline-preview-test-secret";
const now = 1700000000;
const file = {
  fileId: "7",
  objectKey: "private/example.pdf",
  mimetype: "application/pdf",
  size: 42,
  uploadTime: "2026-10-20T00:00:00.000Z",
  filename: "example.pdf",
};
const claims = { ...file, userId: 2, revision: previewRevision(file) };
function tokenFrom(url: string) {
  const token = new URL(url, "http://offline.invalid").searchParams.get("token");
  assert.ok(token);
  return token;
}
function signed(overrides = {}, expiresIn = 1800, algorithm: jwt.Algorithm = "HS256") {
  return jwt.sign({ ...claims, ...overrides, iat: now }, secret, { algorithm, expiresIn });
}

test("fresh preview links have the full TTL and explicit HS256 signature", () => {
  const result = createPreviewLink(claims, undefined, secret, now);
  assert.equal(result.expiresIn, 1800);
  const payload = jwt.verify(tokenFrom(result.url), secret, {
    algorithms: ["HS256"],
    clockTimestamp: now,
  }) as jwt.JwtPayload;
  assert.equal(typeof payload.exp, "number");
  assert.equal(typeof payload.iat, "number");
  assert.equal(Number(payload.exp) - Number(payload.iat), 1800);
  assert.equal(payload.revision, claims.revision);
  assert.equal(payload.filename, undefined);
  assert.equal(payload.size, undefined);
  assert.equal(payload.uploadTime, undefined);
});

test("reuses exactly the same signed URL and reports remaining lifetime", () => {
  const previous = signed();
  const result = createPreviewLink(claims, previous, secret, now + 600);
  assert.equal(tokenFrom(result.url), previous);
  assert.equal(result.expiresIn, 1200);
});

test("expiry safety boundary requires more than 120 seconds", () => {
  const previous = signed();
  assert.equal(tokenFrom(createPreviewLink(claims, previous, secret, now + 1679).url), previous);
  for (const elapsed of [1680, 1799, 1800, 1801]) {
    const result = createPreviewLink(claims, previous, secret, now + elapsed);
    assert.notEqual(tokenFrom(result.url), previous);
    assert.equal(result.expiresIn, 1800);
  }
});

test("never reuses invalid, wrong-algorithm, excessive-lifetime or obsolete tokens", () => {
  const tokens = [
    "invalid",
    "x".repeat(8193),
    jwt.sign({ ...claims, iat: now }, "wrong-secret", { expiresIn: 1800 }),
    signed({}, 1800, "HS384"),
    signed({}, 1801),
    signed({ revision: undefined }),
    signed({ userId: 99 }),
    signed({ fileId: "8" }),
    signed({ mimetype: "image/png" }),
    signed({ objectKey: "private/replaced.pdf" }),
    signed({ revision: "changed" }),
    jwt.sign({ ...claims, iat: now }, secret),
  ];
  for (const previous of tokens) {
    const result = createPreviewLink(claims, previous, secret, now);
    assert.notEqual(tokenFrom(result.url), previous);
    assert.equal(result.expiresIn, 1800);
  }
  for (const previous of [null, {}, [], 7]) {
    assert.equal(createPreviewLink(claims, previous, secret, now).expiresIn, 1800);
  }
});

test("revision changes whenever current file content metadata changes", () => {
  const revision = previewRevision(file);
  for (const change of [
    { fileId: "8" },
    { objectKey: "private/replaced.pdf" },
    { mimetype: "image/png" },
    { size: 43 },
    { uploadTime: "2026-10-21T00:00:00.000Z" },
    { filename: "renamed.pdf" },
  ]) {
    assert.notEqual(previewRevision({ ...file, ...change }), revision);
  }
  assert.equal(
    previewRevision({ ...file, size: "42", uploadTime: new Date(file.uploadTime) }),
    revision
  );
});

test("legacy files without an object key support safe reuse too", () => {
  const legacy = { ...file, objectKey: undefined };
  const legacyClaims = { ...claims, objectKey: undefined, revision: previewRevision(legacy) };
  const first = createPreviewLink(legacyClaims, undefined, secret, now);
  const second = createPreviewLink(legacyClaims, tokenFrom(first.url), secret, now + 1);
  assert.equal(second.url, first.url);
  assert.equal(second.expiresIn, 1799);
});

test("preview tokens are bound to operation tenant and cannot be reused across it", () => {
  const a = createPreviewLink({ ...claims, operationTenantId: 10 }, undefined, secret, now);
  const oldToken = new URL(a.url, "https://local.invalid").searchParams.get("token");
  const b = createPreviewLink({ ...claims, operationTenantId: 20 }, oldToken, secret, now);
  const nextToken = new URL(b.url, "https://local.invalid").searchParams.get("token");
  assert.notEqual(oldToken, nextToken);
});
