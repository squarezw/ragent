import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAILBOX_ID_REQUIRED,
  mailboxGroupKey,
  normalizeMailboxId,
  requireMailboxId,
} from "../lib/automation/mailbox-id.ts";

test("normalizeMailboxId: 正整数原样返回", () => {
  assert.equal(normalizeMailboxId(12), 12);
  assert.equal(normalizeMailboxId(1), 1);
  assert.equal(normalizeMailboxId(999999), 999999);
});

test("normalizeMailboxId: 遗留的 mailbox:<id> 字符串与 system 一律视为无效", () => {
  assert.equal(normalizeMailboxId("mailbox:12"), null);
  assert.equal(normalizeMailboxId("system"), null);
  assert.equal(normalizeMailboxId("12"), null);
});

test("normalizeMailboxId: 非正整数与其他类型一律视为无效", () => {
  const invalid = [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "",
    null,
    undefined,
    true,
    {},
    [],
  ];
  for (const value of invalid) {
    assert.equal(normalizeMailboxId(value), null, `${String(value)} 应判定为无效`);
  }
});

test("requireMailboxId: 合法取值通过", () => {
  assert.equal(requireMailboxId(7), 7);
});

test("requireMailboxId: 缺失 mailboxId 时抛出可识别错误，而非回退 system", () => {
  for (const value of [undefined, null, "system", "mailbox:7", 0, "7"]) {
    assert.throws(
      () => requireMailboxId(value),
      (error: Error) => error.message === MAILBOX_ID_REQUIRED,
      `${String(value)} 应抛错`
    );
  }
});

test("requireMailboxId: 错误信息指明缺失的 mailboxId 字段", () => {
  assert.throws(() => requireMailboxId(undefined), /MAILBOX_ID_REQUIRED/);
});

test("mailboxGroupKey: 分组键为 userId:mailboxId", () => {
  assert.equal(mailboxGroupKey(3, 12), "3:12");
});

test("mailboxGroupKey: 不再出现 mailbox: 字符串编码", () => {
  assert.equal(mailboxGroupKey(3, 12).includes("mailbox:"), false);
});

test("mailboxGroupKey: 不同用户或不同邮箱不会落进同一分组", () => {
  const keys = new Set([mailboxGroupKey(1, 2), mailboxGroupKey(1, 3), mailboxGroupKey(2, 2)]);
  assert.equal(keys.size, 3);
});
