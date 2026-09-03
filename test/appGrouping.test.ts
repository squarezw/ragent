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
