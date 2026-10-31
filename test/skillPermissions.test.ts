import assert from "node:assert/strict";
import { test } from "node:test";
import { canEditSkill, canDeleteSkill, canManageSkillLifecycle, canPublishSkill } from "../lib/skillPermissions.ts";

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

test("内置技能：仅超管可编辑", () => {
  const builtin = { user_id: null, owner_tenant_id: null, is_managed: true };
  assert.equal(canEditSkill(builtin, superAdmin, true, false), true);
  assert.equal(canEditSkill(builtin, tenantAdminT1, false, true), false);
  assert.equal(canEditSkill(builtin, plain, false, false), false);
});

test("内置技能即便作者是你本人也不能改", () => {
  // 同步脚本建的行 user_id 为空；但万一某天它落了某个 user_id，
  // 也不该因此变得可改
  const builtin = { user_id: 5, owner_tenant_id: 1, is_managed: true };
  assert.equal(canEditSkill(builtin, plain, false, false), false);
});

test("is_managed 缺失（老后端）按普通技能处理", () => {
  // 后端没升级时响应里没有这个字段，那时不该把所有技能都锁死
  assert.equal(canEditSkill({ user_id: 5, owner_tenant_id: 1 }, plain, false, false), true);
});

test("super administrators may edit cross-owner shared skills", () => {
  assert.equal(canEditSkill({ user_id: 1, owner_tenant_id: 20 }, { id: 1, tenant_id: 10 }, true, false, 10), true);
  assert.equal(canEditSkill({ user_id: 1, owner_tenant_id: 10 }, { id: 1, tenant_id: 20 }, true, false, 10), true);
});

test("editing grants do not expand lifecycle permissions", () => {
  assert.equal(canManageSkillLifecycle({ is_managed: true }, superAdmin, true, false), false);
  assert.equal(canManageSkillLifecycle({ owner_tenant_id: 20 }, superAdmin, true, false, 10), false);
  assert.equal(canManageSkillLifecycle(adminsSkill, superAdmin, true, false, 1), true);
  assert.equal(canEditSkill({ user_id: 5, owner_tenant_id: 20 }, plain, false, false, 1), false);
});

test("super administrators can delete managed and cross-tenant shared skills", () => {
  assert.equal(canDeleteSkill({ is_managed: true, owner_tenant_id: null }, superAdmin, true, false, 1), true);
  assert.equal(canDeleteSkill({ owner_tenant_id: 20 }, superAdmin, true, false, 10), true);
  assert.equal(canDeleteSkill(null, superAdmin, true, false), false);
});

test("delete authorization preserves ordinary users and lifecycle boundaries", () => {
  assert.equal(canDeleteSkill({ user_id: 5, owner_tenant_id: 1, is_managed: true }, plain, false, false, 1), false);
  assert.equal(canDeleteSkill({ user_id: 5, owner_tenant_id: 20 }, plain, false, false, 1), false);
  assert.equal(canDeleteSkill(adminsSkill, plain, false, false), false);
  assert.equal(canDeleteSkill(adminsSkill, tenantAdminT2, false, true), false);
  assert.equal(canDeleteSkill(adminsSkill, tenantAdminT1, false, true, 1), true);
  assert.equal(canDeleteSkill({ user_id: 5, owner_tenant_id: 1 }, plain, false, false, 1), true);
  assert.equal(canManageSkillLifecycle({ is_managed: true }, superAdmin, true, false), false);
  assert.equal(canManageSkillLifecycle({ owner_tenant_id: 20 }, superAdmin, true, false, 10), false);
});

test("super administrators can publish managed and cross-tenant skills", () => {
  assert.equal(canPublishSkill({ is_managed: true, owner_tenant_id: null }, superAdmin, true, false, 1), true);
  assert.equal(canPublishSkill({ owner_tenant_id: 20 }, superAdmin, true, false, 10), true);
  assert.equal(canPublishSkill(null, superAdmin, true, false), false);
});

test("publish permission preserves non-super review scope and other operations", () => {
  assert.equal(canPublishSkill({ user_id: 5, owner_tenant_id: 1 }, plain, false, false, 1), false);
  assert.equal(canPublishSkill(adminsSkill, tenantAdminT1, false, true, 1), true);
  assert.equal(canPublishSkill(adminsSkill, tenantAdminT2, false, true, 2), false);
  assert.equal(canPublishSkill({ ...adminsSkill, is_managed: true }, tenantAdminT1, false, true, 1), false);
  assert.equal(canManageSkillLifecycle({ is_managed: true }, superAdmin, true, false), false);
  assert.equal(canManageSkillLifecycle({ owner_tenant_id: 20 }, superAdmin, true, false, 10), false);
});
