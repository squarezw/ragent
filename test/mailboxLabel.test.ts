import assert from "node:assert/strict";
import { test } from "node:test";
import { mailboxLabelFromRow } from "../lib/automation/mailbox-id.ts";

test("mailboxLabelFromRow: 名称与邮箱不同时派生为「名称 · 邮箱」", () => {
  assert.equal(
    mailboxLabelFromRow({ name: "售后客服", email: "support@example.com" }),
    "售后客服 · support@example.com"
  );
});

test("mailboxLabelFromRow: 名称与邮箱相同时只显示邮箱，避免重复", () => {
  assert.equal(
    mailboxLabelFromRow({ name: "support@example.com", email: "support@example.com" }),
    "support@example.com"
  );
});

test("mailboxLabelFromRow: 名称为空或缺失时退回邮箱", () => {
  assert.equal(mailboxLabelFromRow({ email: "support@example.com" }), "support@example.com");
  assert.equal(
    mailboxLabelFromRow({ name: "", email: "support@example.com" }),
    "support@example.com"
  );
});

test("mailboxLabelFromRow: 记录缺失时不抛错，返回空串而非 undefined", () => {
  assert.equal(mailboxLabelFromRow(null), "");
  assert.equal(mailboxLabelFromRow(undefined), "");
});

test("mailboxLabelFromRow: 展示名只来自邮箱记录，客户端字段不参与派生（模块 D.3）", () => {
  const row = {
    name: "售后客服",
    email: "support@example.com",
    // 客户端可伪造的同名字段：派生必须忽略它
    mailboxLabel: "财务专用邮箱",
  };
  assert.equal(mailboxLabelFromRow(row), "售后客服 · support@example.com");
});
