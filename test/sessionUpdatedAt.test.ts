import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

test("会话管理接口按更新时间稳定倒序", () => {
  const src = read("pages/api/chat/sessions.ts");
  assert.match(src, /ORDER BY cs\.updated_at DESC NULLS LAST, cs\.id DESC/);
});

test("会话列表显示更新时间，详情显示完整提交日期时间", () => {
  const src = read("app/chat-sessions/page.tsx");
  assert.match(src, /<TableHead>\{t\("updatedAt"\)\}<\/TableHead>/);
  assert.match(src, /formatUpdateTime\(session\.updatedAt\)/);
  assert.match(src, /formatDateTime\(detail\.submittedAt\)/);
  assert.match(src, /format\(date, "yyyy-MM-dd HH:mm:ss"/);
});

test("Chat 历史接口按最后更新时间倒序", () => {
  const src = read("pages/api/chat/session/history.ts");
  assert.match(src, /ORDER BY updated_at DESC/);
});

test("会话时间文案在中英文中保持一致", () => {
  for (const locale of ["zh-CN", "en"]) {
    const messages = JSON.parse(read(`messages/${locale}/chatSessions.json`));
    assert.equal(typeof messages.updatedAt, "string");
  }
});
