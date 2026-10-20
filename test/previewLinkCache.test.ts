import assert from "node:assert/strict";
import test from "node:test";
import { PreviewLinkCache } from "../lib/previewLinkCache.ts";

const url = (token: string) => `/api/file-preview/stream?token=${token}`;

test("retains only a reusable token until the original expiry buffer", () => {
  const cache = new PreviewLinkCache();
  const generation = cache.setScope("user1:tenant1");
  cache.put("a", url("first"), 600, 0, generation);
  assert.equal(cache.get("a", 479_999), "first");
  assert.equal(cache.get("a", 480_000), undefined);
});

test("TTL starts before the authorization request, not at response receipt", () => {
  const cache = new PreviewLinkCache();
  const generation = cache.setScope("user1");
  cache.put("a", url("first"), 300, 1_000, generation);
  assert.equal(cache.get("a", 181_000), undefined);
});

test("account, tenant, and logout changes clear hints and reject late responses", () => {
  const cache = new PreviewLinkCache();
  let generation = cache.setScope("user1:tenant1");
  cache.put("a", url("private"), 600, 0, generation);
  assert.equal(cache.setScope("user1:tenant1"), generation);
  assert.equal(cache.get("a", 1), "private");
  cache.setScope("user1:tenant2");
  cache.put("a", url("late"), 600, 0, generation);
  assert.equal(cache.get("a", 1), undefined);
  generation = cache.setScope("user2:tenant2");
  cache.put("a", url("new"), 600, 0, generation);
  cache.clear();
  cache.put("a", url("lateLogout"), 600, 0, generation);
  assert.equal(cache.get("a", 1), undefined);
});

test("never retains external URLs, missing tokens, or invalid lifetimes", () => {
  const cache = new PreviewLinkCache();
  const generation = cache.setScope("user1");
  for (const candidate of [
    "https://example.com/x?token=x",
    "//example.com/x?token=x",
    "/api/file-preview/stream?",
  ]) {
    cache.put("a", candidate, 600, 0, generation);
    assert.equal(cache.get("a", 1), undefined);
  }
  for (const ttl of [NaN, Infinity, -1, 0, 120]) {
    cache.put("a", url("token"), ttl, 0, generation);
    assert.equal(cache.get("a", 1), undefined);
  }
});

test("bounds memory and removes replaced hints", () => {
  const cache = new PreviewLinkCache(2);
  const generation = cache.setScope("user1");
  cache.put("a", url("a"), 600, 0, generation);
  cache.put("b", url("b"), 600, 0, generation);
  cache.put("c", url("c"), 600, 0, generation);
  assert.equal(cache.get("a", 1), undefined);
  assert.equal(cache.get("b", 1), "b");
  cache.put("b", "https://example.com/no-cache", 600, 0, generation);
  assert.equal(cache.get("b", 1), undefined);
});
