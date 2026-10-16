import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePhone, verifyCloudbasePhone } from "../lib/cloudbaseIdentity.ts";
test("phone canonicalization rejects email, foreign and invalid phone identities", () => {
  assert.equal(normalizePhone("+86 13800138000"), "13800138000");
  assert.equal(normalizePhone("13800138000"), "13800138000");
  for (const value of ["alice@example.com", "+11234567890", "123", null, {}])
    assert.equal(normalizePhone(value), null);
});
test("cloud verification fails closed and only accepts verified upstream phone", async () => {
  const oldEnv = process.env.CLOUDBASE_ENV_ID;
  const oldFetch = globalThis.fetch;
  try {
    delete process.env.CLOUDBASE_ENV_ID;
    await assert.rejects(verifyCloudbasePhone("token"), /AUTH_UNAVAILABLE/);
    process.env.CLOUDBASE_ENV_ID = "test-env";
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://test-env.api.tcloudbasegateway.com/auth/v1/user/me");
      assert.equal((init?.headers as any).Authorization, "Bearer token");
      return new Response(JSON.stringify({ sub: "uid", phone_number: "+86 13800138000" }));
    };
    assert.deepEqual(await verifyCloudbasePhone("token"), {
      uid: "uid",
      phone: "13800138000",
      env: "test-env",
    });
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ sub: "uid", email: "alice@example.com" }));
    await assert.rejects(verifyCloudbasePhone("token"), /PHONE_IDENTITY_REQUIRED/);
    globalThis.fetch = async () => new Response("", { status: 401 });
    await assert.rejects(verifyCloudbasePhone("token"), /INVALID_CREDENTIALS/);
    globalThis.fetch = async () => new Response("", { status: 503 });
    await assert.rejects(verifyCloudbasePhone("token"), /AUTH_UNAVAILABLE/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnv === undefined) delete process.env.CLOUDBASE_ENV_ID;
    else process.env.CLOUDBASE_ENV_ID = oldEnv;
  }
});
