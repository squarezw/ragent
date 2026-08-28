import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const PAGE = "app/apps/page.tsx";

/**
 * 数字员工页的租户筛选（2026-08-28）。
 *
 * 这是**便利筛选，不是权限边界**：后端已经按角色收窄过 /api/v1/apps，
 * 非超管本来就只拿得到自己看得见的那些。前端过滤改变不了任何人能拿到什么。
 * 这组断言守的是行为正确，不是安全性 —— 别把它当授权测试读。
 */

test("筛选控件只对超管渲染", () => {
  const src = read(PAGE);
  assert.match(src, /\{isSuperAdmin && tenants\.length > 0 && \(/,
    "非超管只有一个租户，给他一个单选项下拉是噪音");
});

test("筛选作用于渲染列表，而不是只改了数字", () => {
  const src = read(PAGE);
  // 两个视图都要用筛选后的列表；漏一个的表现是「切到表格视图筛选就失效」
  assert.equal((src.match(/visibleApps\.map\(/g) || []).length, 2,
    "表格视图与网格视图都要用 visibleApps");
  assert.match(src, /count: visibleApps\.length/, "统计数字要跟着筛选走");
});

test("嵌入对话框仍列全部应用", () => {
  // 那个下拉是「选一个应用去嵌入」，与当前筛选无关。
  // 跟着筛选走的话，筛了租户 A 就嵌不了租户 B 的应用。
  const src = read(PAGE);
  const seg = src.slice(src.indexOf("selectAppToEmbed"));
  assert.match(seg, /\{apps\.map\(/, "嵌入下拉必须用未筛选的 apps");
});

test("未归属选项只在真的存在未归属应用时出现", () => {
  const src = read(PAGE);
  assert.match(src, /const hasUnassigned = useMemo\(\(\) => apps\.some\(\(a\) => !a\.owner_tenant_id\)/);
  assert.match(src, /\{hasUnassigned && \(/, "否则会挂一个永远为空的条目");
});

test("筛没了与一个都没有是两种空态", () => {
  const src = read(PAGE);
  // 复用「还没有应用，去创建」那个空态会让用户以为该租户的应用被删了
  assert.match(src, /visibleApps\.length === 0 \? \(/);
  assert.match(src, /noAppsForTenant/);
  assert.match(src, /clearTenantFilter/, "要给一条退出筛选的路，否则用户只能刷页面");
});

test("租户列表拉取失败不影响整页", () => {
  const src = read(PAGE);
  const seg = src.slice(src.indexOf('axios\n      .get("/api/organization/tenants")'));
  assert.match(seg.slice(0, 300), /\.catch\(\(\) => setTenants\(\[\]\)\)/,
    "一个可选的筛选控件不该让整页挂掉");
});

test("中英文案齐全且一致", () => {
  const zh = JSON.parse(read("messages/zh-CN/apps.json"));
  const en = JSON.parse(read("messages/en/apps.json"));
  for (const k of ["filterByTenant", "allTenants", "unassignedTenant",
                   "noAppsForTenant", "clearTenantFilter"]) {
    assert.ok(k in zh && k in en, `缺文案 ${k}`);
  }
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});
