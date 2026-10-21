import assert from "node:assert/strict";
import test from "node:test";
import {
  appSelectionKey,
  canManageTenantDefault,
  chooseTenantApp,
  type TenantApp,
} from "../lib/tenantDefaultApp.ts";
const own: TenantApp = {
  id: 1,
  owner_tenant_id: 10,
  is_default: true,
  status: "published",
  visibility: "tenant",
  app_type: "Chat",
  platform: "Web",
};
const shared: TenantApp = { ...own, id: 2, owner_tenant_id: 20, visibility: "public" };

test("restore accessible prior choice, otherwise choose only current tenant default", () => {
  assert.equal(chooseTenantApp([shared, own], "2", 10), "2");
  assert.equal(chooseTenantApp([shared, own], "missing", 10), "1");
  assert.equal(chooseTenantApp([shared], null, 10), "");
  assert.equal(chooseTenantApp([own], null, null), "");
  for (const invalid of [
    { status: "draft" },
    { visibility: "dept" },
    { app_type: "Custom" },
    { platform: "Wechat" },
  ])
    assert.equal(chooseTenantApp([{ ...own, ...invalid }], null, 10), "");
});

test("tenant admins manage their own tenant defaults, superadmins manage any tenant", () => {
  const admin = { id: 3, tenant_id: 10, isTenantAdmin: true };
  assert.equal(canManageTenantDefault({ ...own, is_default: false }, admin), true);
  assert.equal(canManageTenantDefault(shared, admin), false);
  assert.equal(canManageTenantDefault(own, { id: 3, tenant_id: 10 }), false);
  assert.equal(canManageTenantDefault(shared, { id: 3, isSuperAdmin: true }), true);
  for (const invalid of [
    { status: "draft" },
    { visibility: "private" },
    { owner_tenant_id: null },
    { app_type: "Custom" },
    { platform: "Wechat" },
  ])
    assert.equal(canManageTenantDefault({ ...own, is_default: false, ...invalid }, admin), false);
  assert.equal(
    canManageTenantDefault({ ...own, status: "draft" }, admin),
    true,
    "existing invalid flags can be cleared"
  );
});

test("selection keys isolate different users, tenants and unassigned accounts", () => {
  const keys = [
    appSelectionKey(1, 10),
    appSelectionKey(2, 10),
    appSelectionKey(1, 20),
    appSelectionKey(1, null),
  ];
  assert.equal(new Set(keys).size, keys.length);
});
