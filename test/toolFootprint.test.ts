import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const TOOLS_PAGE = read("app/tools/page.tsx");
const TOOLS_HOOK = read("hooks/useTools.ts");
const TOOL_DETAIL_PAGE = read("app/tools/[id]/page.tsx");
const TOOL_CONNECTION_PROXY = read("pages/api/tools/[id]/test-connection.ts");

/**
 * 界面上一个 MCP 工具只是一行 140 字节的地址，运行时它展开成几十个子工具的完整
 * JSON Schema 并每轮全量重发。2026-08-25 实测：一句「你好」耗 39,550 输入 token，
 * 约 92% 是工具定义，企查查四个端点独占 86%。
 *
 * 这组断言守的是：那段落差要看得见，且三种状态不能混为一谈 ——
 * 「占 9k」「不走 MCP 注册」「注册失败模型调不到」。
 */
test("Tool 类型带 footprint", () => {
  assert.match(TOOLS_HOOK, /footprint\?: \{/, "类型里没有 footprint，接口给了也读不到");
  for (const f of ["subtool_count", "estimated_tokens", "status"]) {
    assert.ok(TOOLS_HOOK.includes(f), `footprint 少了 ${f}`);
  }
});

test("工具列表渲染四档连接状态与占用提示", () => {
  assert.ok(TOOLS_PAGE.includes("ToolConnectionStatus"), "没有渲染连接状态");
  assert.ok(TOOLS_PAGE.includes("footprintSummary"), "没有子工具数与 token 的文案");
  for (const status of ["connUntested", "connOk", "connUnconfigured", "connFailed"]) {
    assert.ok(TOOLS_PAGE.includes(status), `没有 ${status} 状态`);
  }
});

test("未验证 MCP 与不建立连接的工具分开处理", () => {
  // MCP 缺 footprint 是按需注册前的正常「未验证」状态；native / workflow 才完全不渲染。
  assert.match(
    TOOLS_PAGE,
    /if \(tool\.tool_type !== "mcp"\) return null;/,
    "native / workflow 不应渲染连接状态"
  );
  assert.match(TOOLS_PAGE, /if \(!fp\)/, "缺 footprint 的 MCP 必须显示未验证状态");
  assert.ok(TOOLS_PAGE.includes("connUntested"), "缺 footprint 时没有未验证文案");
});

test("失败与未配置的诊断通过可聚焦 Tooltip 提供", () => {
  for (const status of ["unconfigured", "failed"]) {
    assert.match(TOOLS_PAGE, new RegExp(`fp\\.status === "${status}"`), `没区分 ${status}`);
  }
  assert.ok(TOOLS_PAGE.includes("ConnectionStatusTooltip"), "没有状态详情 Tooltip");
  assert.ok(TOOLS_PAGE.includes("TooltipTrigger asChild"), "Tooltip trigger 不能获得键盘焦点");
  assert.ok(TOOLS_PAGE.includes('type="button"'), "状态控件必须是可聚焦按钮");
  assert.ok(TOOLS_PAGE.includes("aria-label={ariaLabel}"), "状态控件没有无障碍标签");
  assert.ok(TOOLS_PAGE.includes("error={fp.error}"), "完整诊断没有传给 Tooltip");
  assert.ok(TOOLS_PAGE.includes("max-w-[calc(100vw-2rem)]"), "Tooltip 没有受视口约束");
  assert.ok(TOOLS_PAGE.includes("break-words"), "Tooltip 长诊断不会断词");
  assert.ok(!/\{fp\.error \?/.test(TOOLS_PAGE), "不能把完整诊断直接写进表格正文");
});

test("批量体检把未取得结果作为未知状态汇总", () => {
  assert.match(TOOLS_PAGE, /const unknown = results\.filter\(\(r\) => !r\.result\)/);
  assert.match(TOOLS_PAGE, /bad\.length === 0 && unknown\.length === 0/);
  assert.match(TOOLS_PAGE, /unknown: unknown\.length/);
});

test("详情页呈现四种连接体检结果且错误文本可收缩", () => {
  for (const status of ["ok", "failed", "unconfigured", "not_applicable"]) {
    assert.ok(
      TOOL_DETAIL_PAGE.includes(`testResult.status === "${status}"`),
      `详情页没有呈现 ${status} 体检结果`
    );
  }
  assert.ok(TOOL_DETAIL_PAGE.includes("[overflow-wrap:anywhere]"));
  assert.ok(TOOL_DETAIL_PAGE.includes("max-w-full"));
});

test("浏览器请求超时大于代理的 30 秒上限", () => {
  assert.match(TOOL_CONNECTION_PROXY, /timeout: 30000/);
  assert.match(TOOLS_HOOK, /timeout: 35000/);
});

test("两个语种的文案齐全且对应", () => {
  const zh = JSON.parse(read("messages/zh-CN/tools.json"));
  const en = JSON.parse(read("messages/en/tools.json"));
  const zhKeys = Object.keys(zh)
    .filter((k) => k.startsWith("footprint") || k.startsWith("conn"))
    .sort();
  const enKeys = Object.keys(en)
    .filter((k) => k.startsWith("footprint") || k.startsWith("conn"))
    .sort();
  for (const key of ["connStatusWithReason", "connNoDiagnostic", "connDiagnostic"]) {
    assert.ok(zhKeys.includes(key), `中文缺少 ${key}`);
  }
  assert.deepEqual(zhKeys, enKeys);
});
