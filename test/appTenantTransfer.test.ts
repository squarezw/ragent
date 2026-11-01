import test from "node:test";
import assert from "node:assert/strict";
import {
  canConfirmTransfer,
  transferPayload,
  type TransferPreview,
// @ts-expect-error Node native TypeScript tests require explicit .ts source imports.
} from "../lib/appTenantTransfer.ts";
const preview = (): TransferPreview => ({
  app_id: 1,
  source: { tenant_id: 1, tenant_name: "A" },
  target: { tenant_id: 2, tenant_name: "B" },
  expected_version: "opaque",
  preflight_token: "signed",
  expires_at: new Date(Date.now() + 60000).toISOString(),
  can_apply: true,
  warnings: [],
  blockers: [],
  checks: [{ code: "fence", status: "passed" }],
  bindings: [],
  target_defaults: {
    status: "draft",
    visibility: "private",
    owner_dept_id: null,
    is_default: false,
  },
});
test("safe preview builds dedicated CAS payload without source or creator mutations", () => {
  const p = preview();
  assert.equal(canConfirmTransfer(p, [], "reason"), true);
  assert.deepEqual(transferPayload(p, [], " reason ", "uuid"), {
    target_tenant_id: 2,
    expected_version: "opaque",
    preflight_token: "signed",
    confirmed_warning_codes: [],
    reason: "reason",
    idempotency_key: "uuid",
  });
});
test("binding warnings require individual acknowledgment", () => {
  const p = preview();
  p.warnings = [{ code: "binding", message: "Unavailable" }];
  assert.equal(canConfirmTransfer(p, [], "reason"), false);
  assert.equal(canConfirmTransfer(p, ["binding"], "reason"), true);
});
test("acknowledgments never bypass blockers, unsupported checks, expiry or capability", () => {
  for (const change of [
    { blockers: [{ code: "job", message: "active" }] },
    { checks: [{ code: "unknown", status: "unverified" }] },
    { can_apply: false },
    { expires_at: "invalid" },
    { expires_at: new Date(0).toISOString() },
    { preflight_token: null },
  ]) {
    const p = { ...preview(), ...change } as TransferPreview;
    assert.equal(canConfirmTransfer(p, ["job", "unknown"], "reason"), false);
    assert.throws(() => transferPayload(p, [], "reason", "uuid"), /TRANSFER_NOT_READY/);
  }
  assert.equal(canConfirmTransfer(preview(), [], "  "), false);
  assert.equal(canConfirmTransfer(null, [], "reason"), false);
});
