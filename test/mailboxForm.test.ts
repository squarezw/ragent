/**
 * 向导内联新建邮箱的表单校验与请求体（模块 B）。
 *
 * 重点是陷阱 1：密码为空表示"未提供"，请求体里必须**没有** password 字段，
 * 而不是 password: ""——后者在编辑路径下等同于"把凭据覆盖为空"。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_MAILBOX_FORM,
  firstMailboxFormIssue,
  mailboxCreatePayload,
  mailboxUpdatePayload,
  type MailboxFormState,
} from "../lib/automation/mailbox-form.ts";

function form(overrides: Partial<MailboxFormState> = {}): MailboxFormState {
  return {
    ...EMPTY_MAILBOX_FORM,
    email: "sales@corp.com",
    username: "sales@corp.com",
    password: "auth-code",
    imapHost: "imap.corp.com",
    ...overrides,
  };
}

test("EMPTY_MAILBOX_FORM: 端口与文件夹使用服务端默认值", () => {
  assert.equal(EMPTY_MAILBOX_FORM.imapPort, "993");
  assert.equal(EMPTY_MAILBOX_FORM.folder, "INBOX");
  assert.equal(firstMailboxFormIssue(form()), null);
});

test("表单校验: 填写完整时没有阻断问题", () => {
  assert.equal(firstMailboxFormIssue(form({ imapPort: "143", folder: "INBOX/Alert" })), null);
});

test("表单校验: 必填项缺失时返回对应问题代码", () => {
  assert.equal(firstMailboxFormIssue(form({ email: "" })), "email");
  assert.equal(firstMailboxFormIssue(form({ email: "not-an-email" })), "email");
  assert.equal(firstMailboxFormIssue(form({ username: "  " })), "username");
  assert.equal(firstMailboxFormIssue(form({ password: "" })), "password");
  assert.equal(firstMailboxFormIssue(form({ imapHost: "" })), "imapHost");
});

test("表单校验: 端口必须是 1-65535 的整数", () => {
  assert.equal(firstMailboxFormIssue(form({ imapPort: "" })), "imapPort");
  assert.equal(firstMailboxFormIssue(form({ imapPort: "abc" })), "imapPort");
  assert.equal(firstMailboxFormIssue(form({ imapPort: "0" })), "imapPort");
  assert.equal(firstMailboxFormIssue(form({ imapPort: "1.5" })), "imapPort");
  assert.equal(firstMailboxFormIssue(form({ imapPort: "70000" })), "imapPort");
  assert.equal(firstMailboxFormIssue(form({ imapPort: "65535" })), null);
});

test("陷阱 1: 密码未填写时请求体不含 password 字段，而不是空串", () => {
  const payload = mailboxCreatePayload(form({ password: "" }));

  assert.equal("password" in payload, false);
  assert.deepEqual(Object.keys(payload).sort(), [
    "email",
    "folder",
    "imapHost",
    "imapPort",
    "name",
    "username",
  ]);
});

test("新建请求体: 填写了密码时原样下发，不做 trim", () => {
  // 授权码可能含首尾空格，改动它会导致登录失败。
  assert.equal(
    mailboxCreatePayload(form({ password: " pass with space " })).password,
    " pass with space "
  );
});

test("新建请求体: 文本字段去空格，端口与文件夹回落默认值", () => {
  const payload = mailboxCreatePayload(
    form({ imapPort: "", folder: "  ", imapHost: " imap.corp.com ", email: " sales@corp.com " })
  );

  assert.equal(payload.imapPort, 993);
  assert.equal(payload.folder, "INBOX");
  assert.equal(payload.imapHost, "imap.corp.com");
  assert.equal(payload.email, "sales@corp.com");
});

test("新建请求体: 名称留空时下发空串，由服务端回落到邮箱地址", () => {
  assert.equal(mailboxCreatePayload(form({ name: "" })).name, "");
  assert.equal(mailboxCreatePayload(form({ name: " 销售部邮箱 " })).name, "销售部邮箱");
});

test("编辑表单校验: 密码可留空（留空表示不修改凭据），其余必填项照旧", () => {
  assert.equal(firstMailboxFormIssue(form({ password: "" }), { passwordOptional: true }), null);
  assert.equal(
    firstMailboxFormIssue(form({ password: "", imapHost: "" }), { passwordOptional: true }),
    "imapHost"
  );
  assert.equal(
    firstMailboxFormIssue(form({ password: "", imapPort: "0" }), { passwordOptional: true }),
    "imapPort"
  );
});

test("编辑请求体: 密码留空时下发空串（而不是省略字段），由服务端理解为保留原值", () => {
  const payload = mailboxUpdatePayload(form({ password: "" }));

  assert.equal("password" in payload, true);
  assert.equal(payload.password, "");
});

test("编辑请求体: 填写了密码时原样下发，不做 trim", () => {
  assert.equal(mailboxUpdatePayload(form({ password: " code " })).password, " code ");
});

test("编辑请求体: 其余字段与新建请求体一致", () => {
  const state = form({ name: " 销售部邮箱 ", imapPort: "143", folder: " Alerts " });
  const { password, ...rest } = mailboxUpdatePayload(state);

  assert.equal(password, "auth-code");
  assert.deepEqual(rest, mailboxCreatePayload({ ...state, password: "" }));
});
