import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

/**
 * 「谁能看到谁的数据」这张梯子的守卫。
 *
 * 2026-08-27 的实况：`pages/api/user/list.ts` 写全了（含「排除更高权限角色」），
 * chat 会话族四个接口各自重写了一遍、**四个都漏了那一条**。后果是租户管理员
 * 在人员管理里看不到超管这个人，却在会话列表、导出、筛选器、会话详情里
 * 读得到他的完整问答内容 —— 人名藏住了，内容没藏。
 *
 * 所以这组断言守的不是「某个文件写对了」，而是「**没有第二个地方在写这张梯子**」。
 * 前者挡不住下一个新接口再抄一遍漏一条。
 */

/** 所有按「查看者是谁」收窄数据的接口。新增同类接口要加进这张表。 */
const SCOPED_ENDPOINTS = [
  "pages/api/user/list.ts",
  "pages/api/chat/sessions.ts",
  "pages/api/chat/sessions/export.ts",
  "pages/api/chat/sessions/filters.ts",
  "pages/api/chat/sessions/[id]/details.ts",
];

test("每个收窄接口都走共用件，没人自己重写阶梯", () => {
  for (const rel of SCOPED_ENDPOINTS) {
    const src = read(rel);
    assert.match(src, /from "@\/lib\/visibilityScope"/, `${rel} 没有引用共用可见性模块`);
  }
});

test("收窄接口里不再出现内联的角色分档", () => {
  // `isTenantAdmin(` / `isDeptAdmin(` 出现在这些文件里，就说明有人又在本地
  // 判档位、进而很可能又在本地拼收窄条件 —— 那正是漏掉排除子句的入口。
  for (const rel of SCOPED_ENDPOINTS) {
    const src = read(rel);
    for (const banned of ["isTenantAdmin(", "isDeptAdmin("]) {
      assert.ok(!src.includes(banned), `${rel} 仍在本地判角色（${banned}），应改用 buildVisibilityScope 的 tier`);
    }
  }
});

test("阶梯四档在共用件里齐全，且都带排除子句", () => {
  const src = read("lib/visibilityScope.ts");
  assert.match(src, /tier === "tenant"/, "缺租户管理员档");
  assert.match(src, /tier === "dept"/, "缺部门管理员档");
  assert.match(src, /tier === "self"/, "缺只看自己档");

  // 租户管理员排超管；部门管理员排超管 + 租户管理员
  assert.match(src, /excludeHigherRoles\(cols\.userIdCol, \["超级管理员"\]\)/);
  assert.match(src, /excludeHigherRoles\(cols\.userIdCol, \["超级管理员", "租户管理员"\]\)/);
});

test("角色判据带 is_system，与 isSuperAdmin 同口径", () => {
  const src = read("lib/visibilityScope.ts");
  // 租户能自建同名角色。只比名字的话，同一个人在两条代码路径上是不同角色。
  assert.match(src, /r\.name === name && r\.isSystem/, "档位判定漏了 is_system");
  assert.match(src, /r_v\.is_system/, "SQL 排除子句漏了 is_system");
  assert.match(src, /r\.is_system/, "JS 层单行判据漏了 is_system");
});

test("部门按子树而不是精确部门", () => {
  const src = read("lib/visibilityScope.ts");
  // 技术部的管理员要看得到开发组、数据组的人。
  assert.match(src, /LIKE dv\.path \|\| '\/%'/, "缺子树匹配");
  // path 前缀必须带分隔符：TECHOPS 以 TECH 开头，但它是同级的另一个部门
  assert.ok(!/LIKE dv\.path \|\| '%'/.test(src), "裸前缀匹配会把同前缀的兄弟部门算成下级");
});

test("缺范围数据收敛到只看自己，而不是放开", () => {
  const src = read("lib/visibilityScope.ts");
  // 有角色但 tenantId/deptId 为空时必须落到 self —— 后端曾把「查不到租户」
  // 和「不限租户」共用一个 null 哨兵，结果无租户的普通用户看到了全平台。
  assert.match(src, /hasSystemRole\(perms, "租户管理员"\) && perms\.tenantId/);
  assert.match(src, /hasSystemRole\(perms, "部门管理员"\) && perms\.deptId/);
  assert.match(src, /return "self"/, "缺兜底档");
});

test("列表与单行判据是同一张梯子", () => {
  const src = read("lib/visibilityScope.ts");
  // 列表里看不到、详情却打得开（或反过来）就是漏洞
  assert.match(src, /export async function canViewOwner/);
  for (const tier of ['"super"', '"tenant"', '"dept"']) {
    assert.ok(
      src.includes(`tier === ${tier}`),
      `canViewOwner/buildVisibilityScope 缺 ${tier} 档`
    );
  }
});

test("筛选器的部门下拉每一档都有条件", () => {
  const src = read("pages/api/chat/sessions/filters.ts");
  // 原先普通用户那一档没给 deptWhereConditions，于是只剩 status='active'，
  // 把全库所有租户的部门树（含 path）返给了任何登录用户。
  const branch = src.slice(src.indexOf("部门下拉框"));
  for (const t of ['tier === "tenant"', 'tier === "dept"']) {
    assert.ok(branch.includes(t), `部门下拉缺 ${t} 档`);
  }
  assert.match(branch, /deptWhereConditions\.push\(`id = \$\$\{deptParamIndex\}`\)/,
    "普通用户档必须把部门收窄到自己那个，不能什么都不加");
});
