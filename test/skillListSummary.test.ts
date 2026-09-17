import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const listPage = readFileSync(join(process.cwd(), "app/skills/page.tsx"), "utf8");
const bindDialog = readFileSync(
  join(process.cwd(), "app/apps/components/AppSkillsSection.tsx"),
  "utf8"
);

test("列表消费服务端摘要状态，不依赖未返回的正文", () => {
  assert.match(listPage, /has_unpublished_changes/);
  assert.doesNotMatch(listPage, /resolveReviewStatus\(skill\.status, skill\.published_content\)/);
  assert.match(bindDialog, /skill\.is_published === true/);
  assert.doesNotMatch(bindDialog, /skill\.published_content !== null/);
});
