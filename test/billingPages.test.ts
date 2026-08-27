import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(REPO, rel));

const HOOK = read("hooks/useBilling.ts");
const USAGE = read("app/billing/page.tsx");
// 计费系数不再是独立页面，收进了系统设置（2026-08-27）
const RATES = read("app/system-settings/components/BillingRatesSection.tsx");
const SIDEBAR = read("app/components/AppSidebar.tsx");

/**
 * 每个 /api/v1/... 调用都要有对应的 Next.js 转发文件，否则浏览器拿到的是
 * Next 自己报的 404 —— 看起来像「后端没实现这个接口」，实际后端好好的，
 * 少的是中间那一层。skillsProxyCoverage 为同类疏漏建过守卫，这里覆盖 billing。
 */
test("每个 billing 接口都有转发文件", () => {
  const proxies = [
    "pages/api/v1/billing/usage/summary.ts",
    "pages/api/v1/billing/usage/turns.ts",
    "pages/api/v1/billing/rates/index.ts",
    "pages/api/v1/billing/rates/audit.ts",
    "pages/api/v1/billing/rates/[rate_type]/[ref_key].ts",
  ];
  for (const p of proxies) {
    assert.ok(exists(p), `缺转发文件：${p}`);
  }
});

test("转发的查询参数白名单覆盖 hook 实际会传的", () => {
  // passQuery 没列到的参数会被**静默丢掉**，表现是「筛选点了没反应」。
  const summary = read("pages/api/v1/billing/usage/summary.ts");
  for (const q of ["group_by", "start", "end", "tenant_id", "user_id"]) {
    assert.ok(summary.includes(`"${q}"`), `summary 代理漏了参数 ${q}`);
  }
  const turns = read("pages/api/v1/billing/usage/turns.ts");
  for (const q of ["session_id", "page", "page_size", "start", "end"]) {
    assert.ok(turns.includes(`"${q}"`), `turns 代理漏了参数 ${q}`);
  }
});

test("权限错误要显示出来，不能静默空列表", () => {
  // 非超管查别的租户会 403。吞掉它、只显示空表，会被读成
  // 「这段时间没有消耗」—— 一个看起来正常的错误答案。
  // 断言 catch 块里**真的把错误信息写进了 error 态**。
  // 只查 `setError(` 存在是无效断言 —— setError(null) 也匹配，
  // 而把 catch 里那行删掉照样绿（2026-08-26 变异验证时发现）。
  const catchBlock = HOOK.slice(HOOK.indexOf("} catch (e: unknown) {"));
  assert.match(
    catchBlock.slice(0, 400),
    /setError\([^)]*detail/,
    "catch 里没有把后端返回的原因写进 error 态"
  );
  assert.match(USAGE, /summary\.error &&/, "用量页没有渲染错误");
  assert.match(RATES, /if \(error\)/, "系数页没有渲染错误");
});

test("轮次明细展开显示分项，且标出吃默认值的项", () => {
  // 一笔积分要能展开到它由什么构成（§6.3）；「吃默认值」必须可见，
  // 否则「明确设 0」和「忘了设」在界面上一样。
  assert.ok(USAGE.includes("breakdown"), "没有用 breakdown");
  assert.match(USAGE, /using_default/, "没有标出吃默认值的项");
  assert.ok(USAGE.includes("已扣除工具定义"), "没有说明计费口径已扣工具定义");
});

test("系数页突出「在吃默认值」的清单", () => {
  assert.ok(RATES.includes("usingDefault"), "没有展示在吃默认值的条目");
  assert.ok(RATES.includes("回落到全局默认"), "删除的语义没说清（删除≠免费）");
});

test("导出 CSV 带 BOM", () => {
  // 没有 BOM，Excel 打开中文列头是乱码 —— 用户会以为导出坏了
  assert.match(USAGE, /"\\uFEFF"|\uFEFF/, "CSV 没加 BOM");
});

test("侧边栏有用量明细入口；系数不再单开菜单", () => {
  assert.ok(SIDEBAR.includes('t("billingUsage")'), "没有用量明细入口");
  // 计费系数收进系统设置页（它是全站唯一一份配置，不值得占一级菜单）。
  // 权限由系统设置页本身把关：那一页就是 visible: isSuperAdmin。
  assert.doesNotMatch(SIDEBAR, /path: "\/billing\/rates"/, "系数页又单开了菜单");
});

test("计费系数在系统设置页里", () => {
  const settings = read("app/system-settings/page.tsx");
  assert.match(settings, /BillingRatesSection/, "系统设置页没有引用计费系数区块");
});

test("两个语种的导航文案齐全", () => {
  const zh = JSON.parse(read("messages/zh-CN/navigation.json"));
  const en = JSON.parse(read("messages/en/navigation.json"));
  for (const k of ["billingUsage"]) {
    assert.ok(zh[k], `zh-CN 缺 ${k}`);
    assert.ok(en[k], `en 缺 ${k}`);
  }
});

test("改系数用 modal，不是页面底部的内联表单", () => {
  // 内联表单的问题：点不同行只是让下方那块内容变，用户要滚下去找。
  // 「在吃默认值」当前有十几个条目，逐个设置时会完全失去位置感。
  assert.match(RATES, /<Dialog\s/, "编辑器不是 Dialog");
  assert.match(RATES, /open=\{editing !== null\}/, "Dialog 没有跟编辑态绑定");
});

test("关闭 modal 时清空编辑态", () => {
  // 不清的话，下次打开会带着上一条的值和原因 —— 原因串到别的条目上，
  // 审计记录就写错了。
  const block = RATES.slice(RATES.indexOf("onOpenChange"));
  assert.match(block.slice(0, 300), /setEditing\(null\)/);
  assert.match(block.slice(0, 300), /setValue\(""\)/, "没清空系数输入");
  assert.match(block.slice(0, 300), /setReason\(""\)/, "没清空变更原因");
});
