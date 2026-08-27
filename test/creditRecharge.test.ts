import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(REPO, rel));

/**
 * 积分充值（2026-08-27）：超管在组织管理里给租户预充。
 *
 * 用户裁定：**充值接口只能放在 Python 后端，不能放在 Node 服务里。**
 * 这一条不是风格偏好 —— Node 这边多写一行判断，就多一处可以和后端不一致的地方，
 * 而不一致的那一处会是钱。
 */

const PROXIES = [
  "pages/api/v1/billing/recharge.ts",
  "pages/api/v1/billing/accounts.ts",
  "pages/api/v1/billing/recharges.ts",
];

test("三个接口都有转发文件", () => {
  for (const rel of PROXIES) {
    assert.ok(exists(rel), `${rel} 缺失 —— 浏览器会拿到 Next 自己报的 404，看起来像后端没实现`);
  }
});

test("Node 侧只透传，不含任何充值逻辑", () => {
  for (const rel of PROXIES) {
    const src = read(rel);
    assert.match(src, /proxySkillsApi/, `${rel} 应当只调 proxySkillsApi`);
    // 出现下面任何一样，就说明业务判断爬到了 Node 这一侧
    for (const banned of ["pool.query", "credit_transactions", "INSERT", "isSuperAdmin"]) {
      assert.ok(!src.includes(banned), `${rel} 出现了 ${banned} —— 充值逻辑必须留在 Python 后端`);
    }
  }
});

test("充值只允许 POST", () => {
  const src = read("pages/api/v1/billing/recharge.ts");
  assert.match(src, /allow:\s*\["POST"\]/);
});

test("幂等键在打开对话框时生成，不是提交时", () => {
  // 提交时生成的话，双击会产生两个不同的 key —— 等于没有幂等，两笔都会到账。
  const src = read("app/organization/components/TenantRechargeDialog.tsx");
  // 锚点必须是 effect 的调用处，不能用 indexOf("useEffect") —— 那会命中 import
  // 那一行，切片里带上 `const [idemKey, setIdemKey] = useState("")`，
  // 于是把 setIdemKey 挪走之后断言照样通过（变异验证抓到过这个）。
  const call = src.indexOf("useEffect(() => {");
  assert.ok(call > 0, "找不到 effect 调用处");
  const effect = src.slice(call, src.indexOf("const parsed"));
  assert.match(effect, /setIdemKey\(/, "幂等键必须在 open 的 effect 里生成");
  assert.match(effect, /\[open\]/, "依赖必须是 open");

  const submit = src.slice(src.indexOf("const submit"), src.indexOf("return ("));
  assert.ok(!submit.includes("randomUUID"), "提交路径里不能再生成 key");
});

test("提交中禁用按钮，且金额必须为正", () => {
  const src = read("app/organization/components/TenantRechargeDialog.tsx");
  assert.match(src, /disabled=\{!valid \|\| submitting\}/);
  assert.match(src, /parsed > 0/);
});

test("前端不自己算余额", () => {
  // 两边各算一次，迟早有一次算得不一样，而不一样的那个数是钱。
  const hook = read("hooks/useBilling.ts");
  const seg = hook.slice(
    hook.indexOf("export function useCreditAccounts"),
    hook.indexOf("export function useRecharges")
  );
  // total_balance 必须原样落进 state：任何运算（哪怕 `- 0`）都意味着前端在参与算账
  assert.match(
    seg,
    /setTotalBalance\(res\.data\?\.total_balance \?\? 0\);/,
    "余额必须原样取自后端，前端不做任何运算"
  );
  assert.ok(!/balance\s*[-+*/]/.test(seg), "余额只能来自后端，前端不做加减");
});

test("没有账目知情范围的人不显示余额卡片，而不是显示 0", () => {
  // 显示「余额 0」是个看起来合理的假数字，比不显示更糟。
  const src = read("app/billing/page.tsx");
  assert.match(src, /accounts\.length > 0 &&/);
  assert.match(src, /accounts\.length > 0 \? "md:grid-cols-4" : "md:grid-cols-3"/);
});

test("未登记的流水类型会被报出来", () => {
  const src = read("app/billing/page.tsx");
  assert.match(src, /unknown_tx > 0/, "算漏了必须可见，否则余额少算且没有任何症状");
});

test("充值明细展示操作人与备注", () => {
  // 2026-08-27 从页面底部的全表改成按租户的 modal —— 同一件事显示在两个地方，
  // 改了一处忘了另一处就会自相矛盾。
  const src = read("app/billing/components/RechargeHistoryDialog.tsx");
  for (const f of ["operator_name", "r.note", "created_at", "amount"]) {
    assert.ok(src.includes(f), `充值明细缺 ${f} —— 留档要能回答「谁、何时、多少、为什么」`);
  }
  assert.ok(
    !read("app/billing/page.tsx").includes("<CardTitle className=\"text-base\">充值记录"),
    "底部的全表应已移除，只保留 modal 一个入口"
  );
});

test("modal 只在选中租户时挂载", () => {
  // 挂着一个 tenantId=undefined 的实例会去拉全部租户的记录 —— 白拉一次，
  // 而且打开时会先闪一下别人的数据。
  const src = read("app/billing/page.tsx");
  assert.match(src, /\{historyTenant && \(/);
});

test("按租户汇总时才出现剩余积分列与充值明细按钮", () => {
  const src = read("app/billing/page.tsx");
  assert.match(src, /groupBy === "tenant" && \(/, "列必须按分组维度条件渲染");
  assert.ok(src.includes("剩余积分"), "缺剩余积分列");
  assert.ok(src.includes("充值明细"), "缺充值明细按钮");
});

test("查不到账户的租户显示「—」而不是 0", () => {
  // 「余额 0」和「不知道余额」是两回事，写成 0 会让人以为查过了。
  const src = read("app/billing/page.tsx");
  assert.match(src, /balanceOfTenant\(row\.key\) === null\s*\?\s*"—"/);
});

test("有余额但无消耗的租户也要出现在按租户汇总里", () => {
  // 汇总表原本只列有消耗的租户。加了余额列之后，漏掉的那些会让「每行余额之和」
  // 对不上顶部合计卡片 —— 一张自己和自己对不上的账，比没有这一列更糟。
  const src = read("app/billing/page.tsx");
  const seg = src.slice(src.indexOf("const tenantRows"), src.indexOf("const balanceOfTenant"));
  assert.match(seg, /accounts\s*\.filter\(\(a\) => !seen\.has\(a\.tenant_id\)\)/);
  assert.match(seg, /turns: 0/, "补进来的行轮次必须是 0，那正是事实");
});

test("组织管理里每个租户都有余额与充值入口", () => {
  const src = read("app/organization/page.tsx");
  assert.match(src, /balanceOf\(tenant\.id\)/);
  assert.match(src, /setRechargeTenant\(tenant\)/);
  assert.match(src, /<TenantRechargeDialog/);
});

test("中英文案 key 一致", () => {
  const zh = JSON.parse(read("messages/zh-CN/organization.json"));
  const en = JSON.parse(read("messages/en/organization.json"));
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const k of ["recharge", "rechargeTitle", "rechargeDuplicate", "balanceLabel"]) {
    assert.ok(k in zh && k in en, `缺文案 ${k}`);
  }
});
