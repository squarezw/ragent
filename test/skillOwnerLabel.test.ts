import assert from "node:assert/strict";
import { test } from "node:test";
import { getSkillOwnerLabel } from "../lib/skillOwnerLabel.ts";

const owner = { owner_tenant_name: "魔Z公司", owner_dept_name: "开发组" };

test("department sharing shows department with organization in tooltip", () => {
  assert.deepEqual(getSkillOwnerLabel({ ...owner, visibility: "dept" }), {
    label: "开发组", title: "魔Z公司 / 开发组",
  });
});

test("tenant, private and public skills show the actual owner organization", () => {
  for (const visibility of ["tenant", "private", "public"]) {
    assert.deepEqual(getSkillOwnerLabel({ ...owner, visibility }), {
      label: "魔Z公司", title: "魔Z公司",
    });
  }
});

test("missing ownership names never fall back to another workspace or wrong scope", () => {
  assert.deepEqual(getSkillOwnerLabel({ visibility: "tenant", owner_dept_name: "开发组" }), { label: null, title: null });
  assert.deepEqual(getSkillOwnerLabel({ visibility: "dept", owner_tenant_name: "魔Z公司" }), { label: "魔Z公司", title: "魔Z公司" });
  assert.deepEqual(getSkillOwnerLabel({ visibility: "dept", owner_dept_name: "开发组" }), { label: "开发组", title: "开发组" });
  assert.deepEqual(getSkillOwnerLabel({}), { label: null, title: null });
});
