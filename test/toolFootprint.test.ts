import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const TOOLS_PAGE = read("app/tools/page.tsx");
const TOOLS_HOOK = read("hooks/useTools.ts");

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

test("工具列表渲染占用提示", () => {
  assert.ok(TOOLS_PAGE.includes("ToolFootprintHint"), "没有渲染占用提示");
  assert.ok(TOOLS_PAGE.includes("footprintSummary"), "没有子工具数与 token 的文案");
});

test("缺席时不渲染，而不是显示 0", () => {
  // native / workflow 不走 MCP 注册，本来就没有这个块。
  // 造一个 0 会让「不占提示词」和「没被注册」看起来一样。
  assert.match(
    TOOLS_PAGE,
    /if \(!footprint\) return null;/,
    "footprint 缺席时必须整块不渲染",
  );
});

test("注册失败要单独标出来", () => {
  // 连不上的服务器在列表里和正常工具长得一模一样，而模型根本调不到它 ——
  // 实测有三个绑定的 MCP 工具处于这个状态。
  assert.match(TOOLS_PAGE, /footprint\.status === "failed"/, "没区分注册失败");
  assert.ok(TOOLS_PAGE.includes("footprintUnavailable"), "没有失败文案");
});

test("两个语种的文案齐全且对应", () => {
  const zh = JSON.parse(read("messages/zh-CN/tools.json"));
  const en = JSON.parse(read("messages/en/tools.json"));
  const zhKeys = Object.keys(zh).filter((k) => k.startsWith("footprint")).sort();
  const enKeys = Object.keys(en).filter((k) => k.startsWith("footprint")).sort();
  assert.ok(zhKeys.length >= 2);
  assert.deepEqual(zhKeys, enKeys);
});
