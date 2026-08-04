import assert from "node:assert/strict";
import { test } from "node:test";
import { canEditSkill } from "../lib/skillPermissions.ts";

// 角色布尔由调用方传入，所以这里直接给 (user, isSuper, isTenantAdmin) 三件套
const superAdmin = { id: 9, tenant_id: 1 };
const tenantAdminT1 = { id: 6, tenant_id: 1 };
const tenantAdminT2 = { id: 7, tenant_id: 2 };
const deptAdmin = { id: 1, tenant_id: 1 };
const plain = { id: 5, tenant_id: 1 };

const adminsSkill = { user_id: 2, owner_tenant_id: 1 };

test("作者本人可以改", () => {
  assert.equal(canEditSkill({ user_id: 5, owner_tenant_id: 1 }, plain, false, false), true);
});

test("超级管理员可以改别人的", () => {
  assert.equal(canEditSkill(adminsSkill, superAdmin, true, false), true);
});

test("同租户的租户管理员可以改", () => {
  assert.equal(canEditSkill(adminsSkill, tenantAdminT1, false, true), true);
});

test("别的租户的租户管理员不能改", () => {
  assert.equal(canEditSkill(adminsSkill, tenantAdminT2, false, true), false);
});

test("部门管理员不能改别人的", () => {
  // 这就是 2026-08-04 报上来的那一幕：square 是部门管理员，
  // 界面上却在别人的 skill 上给了他「编辑」「删除」两个亮按钮
  assert.equal(canEditSkill(adminsSkill, deptAdmin, false, false), false);
});

test("普通用户不能改别人的", () => {
  assert.equal(canEditSkill(adminsSkill, plain, false, false), false);
});

test("无主租户的 skill 只有超管能碰", () => {
  const orphan = { user_id: null, owner_tenant_id: null };
  assert.equal(canEditSkill(orphan, superAdmin, true, false), true);
  assert.equal(canEditSkill(orphan, tenantAdminT1, false, true), false);
  assert.equal(canEditSkill(orphan, plain, false, false), false);
});

test("id 缺失时按无权限处理", () => {
  // `undefined === undefined` 为 true，不挡住的话会让人看起来像每个无主 skill 的作者
  assert.equal(canEditSkill({ user_id: null }, { id: null }, false, false), false);
  assert.equal(canEditSkill({}, {}, false, false), false);
  assert.equal(canEditSkill(null, plain, false, false), false);
  assert.equal(canEditSkill(adminsSkill, null, false, false), false);
});
