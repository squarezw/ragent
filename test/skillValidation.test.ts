import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  formatNameList,
  isValidSkillDescription,
  isValidSkillName,
  parseNameList,
} from "../lib/skillValidation.ts";

test("isValidSkillName 接受合法 kebab-case", () => {
  for (const name of ["weekly-report-format", "a", "a1", "skill-2-v3", "0-day"]) {
    assert.equal(isValidSkillName(name), true, name);
  }
});

test("isValidSkillName 拒绝非法名称", () => {
  const bad = [
    "",
    "Weekly-Report", // 大写
    "-leading",
    "trailing-",
    "double--hyphen",
    "under_score",
    "空格 name",
    "中文名",
    "dot.name",
  ];
  for (const name of bad) {
    assert.equal(isValidSkillName(name), false, name);
  }
});

test("isValidSkillDescription 非空且 ≤1024", () => {
  assert.equal(isValidSkillDescription("Use when the user asks for a weekly report"), true);
  assert.equal(isValidSkillDescription(""), false);
  assert.equal(isValidSkillDescription("   "), false);
  assert.equal(isValidSkillDescription("x".repeat(SKILL_DESCRIPTION_MAX_LENGTH)), true);
  assert.equal(isValidSkillDescription("x".repeat(SKILL_DESCRIPTION_MAX_LENGTH + 1)), false);
});

test("parseNameList 逗号分隔去空去重（含中文逗号）", () => {
  assert.deepEqual(parseNameList("get_weather, search_docs ,get_weather"), [
    "get_weather",
    "search_docs",
  ]);
  assert.deepEqual(parseNameList("a，b, ,c"), ["a", "b", "c"]);
  assert.deepEqual(parseNameList(""), []);
  assert.deepEqual(parseNameList(" , ，"), []);
});

test("formatNameList 回显与空值容错", () => {
  assert.equal(formatNameList(["a", "b"]), "a, b");
  assert.equal(formatNameList([]), "");
  assert.equal(formatNameList(undefined), "");
  assert.equal(formatNameList(null), "");
});
