/**
 * 数字员工列表的租户分组（2026-09-03）。
 *
 * 分组错了不会报错，只会让人在错误的组里找员工——尤其「未归属」那类，
 * 混进某个真实租户下面等于谎报归属。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupAppsByTenant } from "../lib/appGrouping.ts";
import { readFileSync } from "node:fs";

const names = new Map([[1, "牟其科技"], [2, "紫丹"]]);
const app = (id: number, t: number | null) => ({ id, owner_tenant_id: t });

test("按租户分组，组内顺序原样保留", () => {
  // 后端已按「默认置顶 + 更新时间倒序」排好；这里再排一次就是把规则复制到
  // 第二个地方，两边迟早分叉
  const g = groupAppsByTenant([app(5, 1), app(3, 1), app(9, 1)], names, "未归属");
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].apps.map((a) => a.id), [5, 3, 9]);
});

test("组的顺序 = 各组第一个应用的出现顺序（即最近更新的租户在前）", () => {
  const g = groupAppsByTenant([app(1, 2), app(2, 1), app(3, 2)], names, "未归属");
  assert.deepEqual(g.map((x) => x.tenantId), [2, 1]);
  assert.deepEqual(g[0].apps.map((a) => a.id), [1, 3]);
});

test("未归属排在最后，无论它在原数组里多靠前", () => {
  // 它是「待处理」而不是一个真实租户，摆在最前会挤掉真正在用的租户
  const g = groupAppsByTenant([app(1, null), app(2, 1)], names, "未归属");
  assert.deepEqual(g.map((x) => x.tenantId), [1, null]);
  assert.equal(g[1].label, "未归属");
});

test("undefined 与 null 的 owner_tenant_id 归同一组", () => {
  // 后端两种都可能给：字段缺失 vs 显式 null。分成两组会出现两个「未归属」
  const g = groupAppsByTenant(
    [{ id: 1 }, { id: 2, owner_tenant_id: null }], names, "未归属");
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].apps.map((a) => a.id), [1, 2]);
});

test("租户名查不到时回退成「租户 #id」，不留空标题", () => {
  // 租户被删、或租户列表没拉到时，一组应用挂在空白标题下看不出归属
  const g = groupAppsByTenant([app(1, 99)], names, "未归属");
  assert.equal(g[0].label, "租户 #99");
});

test("空输入给空数组", () => {
  assert.deepEqual(groupAppsByTenant([], names, "未归属"), []);
});

test("每个应用只出现一次", () => {
  const apps = [app(1, 1), app(2, 2), app(3, null), app(4, 1)];
  const g = groupAppsByTenant(apps, names, "未归属");
  const ids = g.flatMap((x) => x.apps.map((a) => a.id)).sort();
  assert.deepEqual(ids, [1, 2, 3, 4]);
});

test("表格组头的 colSpan 与表头列数一致", () => {
  // 写死的数字会在加列时悄悄失配：组头那行少铺一格，右边露出一块空白，
  // 不报错、也不容易在自测时注意到。
  const src = readFileSync(
    new URL("../app/apps/page.tsx", import.meta.url), "utf-8");
  const header = src.slice(src.indexOf("<TableHeader>"), src.indexOf("</TableHeader>"));
  const cols = (header.match(/<TableHead[\s>]/g) ?? []).length;
  const m = src.match(/colSpan=\{(\d+)\}/);
  assert.ok(m, "找不到组头的 colSpan");
  assert.equal(Number(m![1]), cols, `表头 ${cols} 列，组头 colSpan 是 ${m![1]}`);
});

test("卡片组头横跨整行，且不依赖 Tailwind 生成的类", () => {
  // col-span-full 全仓只此一处会用到，Tailwind 扫不到就不生成，
  // 表现是样式静默失效、组头被挤进第一格，右边留一大块空白（初版就是这样）。
  const src = readFileSync(
    new URL("../app/apps/page.tsx", import.meta.url), "utf-8");
  assert.match(src, /gridColumn:\s*"1 \/ -1"/, "组头没有横跨整行的样式");
  assert.ok(!src.includes('className="col-span-full'),
    "又用回了 col-span-full——它依赖 Tailwind 扫描，失效时不报错");
});

test("同一租户的应用不连续时，分组结果仍把它们收在一起", () => {
  // 真实数据就是这样：列表按更新时间排，某个租户的两个应用中间隔着别的租户。
  // 初版只算组头、照旧渲染原扁平列表，于是后面那张卡挂在了上一个组头下面 ——
  // 组头是对的、归属是错的，比不分组更糟，而且肉眼很难发现。
  const apps = [
    app(1, 2),   // 新加坡
    app(2, 6),   // AI预审
    app(3, 5),   // 测试中心
    app(4, 2),   // 新加坡 —— 与 app(1) 中间隔了两个租户
  ];
  const g = groupAppsByTenant(apps, new Map([[2, "新加坡"], [5, "测试中心"], [6, "AI预审"]]), "未归属");
  const sg = g.find((x) => x.tenantId === 2)!;
  assert.deepEqual(sg.apps.map((a) => a.id), [1, 4], "同租户的两个应用没被收在一起");
  // 展平后必须按组连续，否则渲染时又会挂错组头
  const flat = g.flatMap((x) => x.apps.map((a) => a.id));
  assert.deepEqual(flat, [1, 4, 2, 3], "展平顺序不是按组连续的");
});

test("渲染源是分组展平后的数组，不是原扁平列表", () => {
  // 这是上面那个 bug 的接线侧：分组算对了，但渲染时用错数组一样会挂错组头
  const src = readFileSync(new URL("../app/apps/page.tsx", import.meta.url), "utf-8");
  assert.ok(!src.includes("{visibleApps.map((app) => {"),
    "还在直接渲染 visibleApps —— 同租户不连续时卡片会挂到错误的组头下");
  assert.equal((src.match(/\{renderApps\.map\(\(app\) => \{/g) ?? []).length, 2,
    "两处渲染（表格 / 卡片）都要用 renderApps");
  // 关键：分组分支必须把 groups 展平后交给渲染。只把 renderApps 指回原扁平
  // 列表就退回了本次的 bug —— 组头位置算对了，卡片却挂在错误的租户名下。
  assert.match(src, /renderApps: groups\.flatMap\(/,
    "分组时渲染源必须是 groups 展平的结果，不能是原扁平列表");
});

test("列表显示的日期与排序依据是同一个字段", () => {
  // 排序按 updated_at、卡片显示 created_at，用户就无法从界面判断排序对不对——
  // 这次正是因此被误判成「排序坏了」。
  const src = readFileSync(new URL("../app/apps/page.tsx", import.meta.url), "utf-8");
  assert.ok(!/new Date\(app\.created_at\)\.toLocaleDateString\(\)/.test(src),
    "列表还在显示创建时间，而排序按的是更新时间");
  assert.match(src, /app\.updated_at \|\| app\.created_at/,
    "显示更新时间时要对 null 兜底（updated_at 可空）");
});
