import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SKILL_BODY_SCAFFOLD,
  hasUnfilledPlaceholders,
  isUntouchedScaffold,
} from "../lib/skillScaffold.ts";

test("脚手架含三个约定小节，且只有结构没有解释文字", () => {
  for (const heading of ["## Workflow", "## References", "## Guardrails"]) {
    assert.ok(SKILL_BODY_SCAFFOLD.includes(heading), `缺小节 ${heading}`);
  }
  // 正文逐字注入 system prompt——说明性文字必须留在帮助文案里，不能进脚手架
  const prose = SKILL_BODY_SCAFFOLD.split("\n").filter(
    (l) => l.trim() && !l.startsWith("##") && !["...", "1. ...", "- ..."].includes(l.trim())
  );
  assert.deepEqual(prose, []);
  // 触发条件由 description 字段承担，正文不重复
  assert.ok(!SKILL_BODY_SCAFFOLD.includes("When to use"));
});

test("isUntouchedScaffold 只对原样未动的脚手架为真", () => {
  assert.equal(isUntouchedScaffold(SKILL_BODY_SCAFFOLD), true);
  // 首尾空白不算改动
  assert.equal(isUntouchedScaffold(`\n${SKILL_BODY_SCAFFOLD}  `), true);
  assert.equal(isUntouchedScaffold(`${SKILL_BODY_SCAFFOLD}\n## 额外`), false);
  assert.equal(isUntouchedScaffold(""), false);
});

test("hasUnfilledPlaceholders 认出三种占位形态", () => {
  assert.equal(hasUnfilledPlaceholders(SKILL_BODY_SCAFFOLD), true);
  assert.equal(hasUnfilledPlaceholders("## Workflow\n\n...\n"), true);
  assert.equal(hasUnfilledPlaceholders("## Workflow\n\n1. ...\n"), true);
  assert.equal(hasUnfilledPlaceholders("## Guardrails\n\n- ...\n"), true);
  // 全部填好后为假
  assert.equal(hasUnfilledPlaceholders("## Workflow\n\n1. 读通表\n2. 填叙述\n"), false);
  // 行内出现省略号不算未填占位
  assert.equal(hasUnfilledPlaceholders("## Workflow\n\n1. 先读 A...再读 B\n"), false);
});
