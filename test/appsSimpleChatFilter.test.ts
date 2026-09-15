import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const SIMPLE = "pages/api/apps/simple.ts";

/**
 * 聊天底部数字员工列表（/api/apps/simple）对未发布应用的收窄（2026-09-16）。
 *
 * 后端 is_simple 已按「已发布 | 自己创建」过滤；这里再滤一道，避免旧后端漏网。
 * 超管也看不到别人的草稿——管理与审核走完整 /api/v1/apps，不走这条。
 */
test("simple 列表对未发布应用只放行创建者", () => {
  const src = fs.readFileSync(path.join(REPO, SIMPLE), "utf8");
  assert.match(src, /status === ["']published["']/);
  assert.match(src, /Number\(app\.user_id\) === Number\(userId\)/);
  assert.match(src, /is_simple/, "请求仍须带 is_simple，让后端先收窄");
});
