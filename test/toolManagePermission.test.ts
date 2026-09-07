import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

const SIDEBAR = "app/components/AppSidebar.tsx";
const PAGE = "app/tools/page.tsx";

/**
 * 工具管理的授权阶梯（2026-09-04）：超级管理员或租户管理员。
 *
 * 与数字员工那个租户筛选不同，**这一组是授权测试**。此前的实际状态是：
 * 后端三个写端点一个角色检查都没有，任何登录用户都能建/改/删/停用任意工具；
 * 唯一拦着的是侧边栏那行 `visible: isSuperAdmin`。"看不见入口"不是权限——
 * 直接敲 /tools（页面对写操作也不设门）或直接调 API 都绕得过。
 *
 * 真正的门在后端 `_require_tool_manager`。这里守的是**前端判据与它逐字一致**：
 * 前端比后端宽 → 用户看到点了就 403 的按钮；比后端窄 → 有权限的人被挡在界面外。
 * 两种都不会报错，只能靠人试出来。
 */

test("侧边栏工具入口对超管与租户管理员可见", () => {
  const src = read(SIDEBAR);
  assert.match(src, /const canManageTools = isSuperAdmin \|\| isTenantAdmin;/,
    "判据必须显式写成 超管 || 租户管理员");
  assert.match(src, /path: "\/tools", visible: canManageTools/,
    "工具入口的 visible 必须用这条判据");
});

test("工具入口不能复用 canManageOperation", () => {
  const src = read(SIDEBAR);
  const line = src.split("\n").find((l) => l.includes('path: "/tools"')) ?? "";
  assert.ok(
    !line.includes("canManageOperation"),
    "canManageOperation 含部门管理员，而后端不放部门管理员：" +
      "复用它会让部门管理员看到入口、每个操作都 403",
  );
});

test("canManageOperation 确实含部门管理员（上一条的前提）", () => {
  // 如果哪天 canManageOperation 不再含部门管理员，上面那条禁令就失去意义，
  // 会变成一条"永远绿"的断言。把前提本身钉住。
  const src = read(SIDEBAR);
  assert.match(src, /const canManageOperation = isSuperAdmin \|\| isTenantAdmin \|\| isDeptAdmin;/,
    "前提变了：canManageOperation 的成分已改，请重新评估工具入口该用哪条判据");
});

test("工具页的写操作全部受同一条判据管", () => {
  const src = read(PAGE);
  assert.match(src, /const canManageTools = isSuperAdmin \|\| checkTenantAdmin\(user\);/,
    "页面判据必须与侧边栏、后端同口径");

  // 新建
  assert.match(src, /\{tab === "managed" && canManageTools && \(/, "「添加工具」按钮没设门");
  // 编辑
  assert.match(src, /\{canManageTools && \(\s*<Button variant="ghost" size="sm" onClick=\{\(\) => handleEdit\(tool\)\}>/,
    "「编辑」按钮没设门");
  // 删除
  assert.match(src, /\{canManageTools && tool\.tool_type !== "workflow" && \(/, "「删除」按钮没设门");
  // 启停开关
  assert.match(src, /disabled=\{!canManageTools\}/, "启停开关没设门——它调的是 update_tool");
});

test("启停开关不是只藏了按钮而已", () => {
  // Switch 是唯一一个用 disabled 而不是不渲染的控件：藏掉它会让人看不出
  // 工具当前是启用还是停用。所以必须是 disabled，不能是条件渲染。
  const src = read(PAGE);
  const idx = src.indexOf("<Switch");
  assert.ok(idx !== -1, "找不到启停开关");
  const block = src.slice(idx, idx + 260);
  assert.ok(block.includes("checked={tool.is_enabled}"), "开关仍要显示真实状态");
  assert.ok(block.includes("disabled={!canManageTools}"), "无权限时必须是禁用而不是隐藏");
});

/**
 * 创建人字段（2026-09-04）。
 *
 * 取代了原来的 `author` —— 表单上一个手填的文本框，回答不了"谁建的"
 * （线上 15 行里 14 行是 System 或 NULL）。后端改为从请求边界记 `created_by`。
 */

test("表单里不再有作者输入框", () => {
  const src = read("app/tools/components/ToolFormDialog.tsx");
  assert.ok(!/formData\.author/.test(src), "表单仍在读写 author");
  assert.ok(!/authorLabel|authorPlaceholder/.test(src), "作者输入框还在");
});

test("Tool 类型里 author 已换成只读的创建人", () => {
  const src = read("hooks/useTools.ts");
  assert.ok(!/^\s*author\?: string;/m.test(src), "author 还留在类型里");
  assert.match(src, /created_by\?: number \| null;/);
  assert.match(src, /created_by_name\?: string \| null;/);
});

for (const [label, file] of [
  ["列表页", "app/tools/page.tsx"],
  ["详情页", "app/tools/[id]/page.tsx"],
] as const) {
  test(`${label}把「未记录」和「用户已注销」分开显示`, () => {
    const src = read(file);
    // 两者共用一个占位符的话，"查不到是谁建的"会被读成"没人建过"——
    // 存量数据（created_by 为 NULL）和账号注销是两件不同的事。
    assert.match(
      src,
      /tool\.created_by_name \|\|\s*\n?\s*\(tool\.created_by \? t\("creatorDeleted"\) : t\("creatorUnknown"\)\)/,
      "两种缺失状态必须区分",
    );
  });
}

test("中英文案键齐全且不再有 author", () => {
  for (const loc of ["zh-CN", "en"]) {
    const json = JSON.parse(read(`messages/${loc}/tools.json`));
    for (const k of ["creator", "creatorUnknown", "creatorDeleted"]) {
      assert.ok(json[k], `${loc} 缺少 ${k}`);
    }
    for (const k of ["author", "authorLabel", "authorPlaceholder"]) {
      assert.ok(!(k in json), `${loc} 仍有 ${k}`);
    }
  }
});
