import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgentMdSaveResult } from "../lib/agentMd.ts";

test("parseAgentMdSaveResult: 抽出 warnings 与归一化全文", () => {
  assert.deepEqual(
    parseAgentMdSaveResult({
      content: "## 角色\n...",
      frontmatter: null,
      is_legacy: false,
      warnings: ["frontmatter 的 model 已忽略并移除：模型由应用设置决定"],
    }),
    {
      warnings: ["frontmatter 的 model 已忽略并移除：模型由应用设置决定"],
      normalizedContent: "## 角色\n...",
    }
  );
});

test("parseAgentMdSaveResult: 没有 warnings 时返回空数组", () => {
  assert.deepEqual(parseAgentMdSaveResult({ content: "body", warnings: null }), {
    warnings: [],
    normalizedContent: "body",
  });
  assert.deepEqual(parseAgentMdSaveResult({ content: "body" }).warnings, []);
});

test("parseAgentMdSaveResult: 丢掉非字符串与空白 warning", () => {
  assert.deepEqual(
    parseAgentMdSaveResult({ content: "body", warnings: ["  ", 5, null, " 真提示 "] }).warnings,
    ["真提示"]
  );
});

test("parseAgentMdSaveResult: content 不是字符串时为 null（调用方保留编辑器内容）", () => {
  assert.equal(parseAgentMdSaveResult({ content: null }).normalizedContent, null);
  assert.equal(parseAgentMdSaveResult({}).normalizedContent, null);
  assert.equal(parseAgentMdSaveResult(null).normalizedContent, null);
  assert.equal(parseAgentMdSaveResult("oops").normalizedContent, null);
});

test("parseAgentMdSaveResult: 空字符串是合法归一化结果，不能退化成 null", () => {
  assert.equal(parseAgentMdSaveResult({ content: "" }).normalizedContent, "");
});
