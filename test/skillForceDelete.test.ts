import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const PAGE = readFileSync(join(process.cwd(), "app/skills/page.tsx"), "utf8");
const PROXY = readFileSync(join(process.cwd(), "pages/api/v1/skills/[id]/index.ts"), "utf8");

test("删除冲突弹窗提供原子化的解绑全部并删除操作", () => {
  assert.match(PAGE, /const handleForceDelete[\s\S]*?deleteSkill\(deletingSkill\.id, true\)/);
  assert.match(PAGE, /variant="destructive" onClick=\{handleForceDelete\}/);
  assert.match(PAGE, /t\("unbindAllAndDelete"\)/);
});

test("Skill 删除代理允许 force 查询参数到达后端", () => {
  assert.match(PROXY, /passQuery:\s*\["force"\]/);
});
