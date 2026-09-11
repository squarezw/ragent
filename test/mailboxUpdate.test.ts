/**
 * 编辑监听邮箱的合并语义（模块 C：密码留空保留原值 + 模块 D.4 游标重置）。
 *
 * 密码那组用例是本次改动里后果最重的一条：把已存凭据覆盖成空串，不会报错、不会告警，
 * 只会让所有绑定该邮箱的自动化在下次轮询时全部登录失败。因此这里断言的是合并后的
 * 密码本身，而不是"函数被调用过"。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  mailboxUpdateInputFromBody,
  mailboxUpdateSuppliesPassword,
  normalizeMailboxConfig,
  resolveMailboxUpdate,
  type MailboxConfig,
  type MailboxConfigInput,
} from "../lib/automation/mailbox-input.ts";

function existingConfig(overrides: Partial<MailboxConfig> = {}): MailboxConfig {
  return {
    name: "销售部邮箱",
    email: "sales@corp.com",
    username: "sales@corp.com",
    password: "stored-auth-code",
    imapHost: "imap.corp.com",
    imapPort: 993,
    imapSecure: true,
    folder: "INBOX",
    ...overrides,
  };
}

/** 只改一个字段的编辑请求。 */
function update(input: MailboxConfigInput) {
  return resolveMailboxUpdate(existingConfig(), input);
}

test("密码留空: 提供了空串时保留原密码，而不是把凭据覆盖为空", () => {
  const { config } = update({ password: "" });

  assert.equal(config.password, "stored-auth-code");
});

test("密码留空: 未提供 password 字段时保留原密码", () => {
  const { config } = update({ name: "售后邮箱" });

  assert.equal(config.password, "stored-auth-code");
});

test("密码留空: undefined 与空串都保留原值，两者含义一致且都不落空", () => {
  assert.equal(update({ password: undefined }).config.password, "stored-auth-code");
  assert.equal(update({ password: "" }).config.password, "stored-auth-code");
});

test("密码更新: 提供了新密码时按新密码生效，且不做 trim（授权码可能含空格）", () => {
  assert.equal(update({ password: "new-code" }).config.password, "new-code");
  assert.equal(update({ password: " code " }).config.password, " code ");
});

test("未提供的字段一律保留原值", () => {
  const { config } = update({ password: "" });

  assert.deepEqual(config, existingConfig());
});

test("已提供的字段覆盖原值，并做归一化（邮箱与主机小写、去首尾空格）", () => {
  const { config } = update({
    email: " Sales@Corp.COM ",
    username: " sales ",
    imapHost: " IMAP2.Corp.com ",
    imapPort: 143,
    imapSecure: false,
    folder: " Alerts ",
    name: " 销售二线 ",
  });

  assert.equal(config.email, "sales@corp.com");
  assert.equal(config.username, "sales");
  assert.equal(config.imapHost, "imap2.corp.com");
  assert.equal(config.imapPort, 143);
  assert.equal(config.imapSecure, false);
  assert.equal(config.folder, "Alerts");
  assert.equal(config.name, "销售二线");
});

test("账号留空时回落到邮箱地址（与创建路径一致）", () => {
  const { config } = update({ username: "" });

  assert.equal(config.username, "sales@corp.com");
});

test("D.4 游标重置: 改 IMAP 主机要重置", () => {
  assert.equal(update({ imapHost: "imap2.corp.com", password: "" }).cursorResetRequired, true);
});

test("D.4 游标重置: 改账号要重置", () => {
  assert.equal(update({ username: "sales2@corp.com", password: "" }).cursorResetRequired, true);
});

test("D.4 游标重置: 改文件夹要重置", () => {
  assert.equal(update({ folder: "Alerts", password: "" }).cursorResetRequired, true);
});

test("D.4 游标重置: 只改密码不重置——密码不移动 UID 基线", () => {
  assert.equal(update({ password: "new-code" }).cursorResetRequired, false);
});

test("D.4 游标重置: 只改名称、端口或加密方式不重置", () => {
  assert.equal(update({ name: "改名了" }).cursorResetRequired, false);
  assert.equal(update({ imapPort: 143 }).cursorResetRequired, false);
  assert.equal(update({ imapSecure: false }).cursorResetRequired, false);
});

test("D.4 游标重置: 主机大小写、文件夹首尾空格、空文件夹等写法差异不算变更", () => {
  assert.equal(update({ imapHost: "IMAP.CORP.COM", folder: "INBOX" }).cursorResetRequired, false);
  assert.equal(update({ imapHost: " imap.corp.com " }).cursorResetRequired, false);
  assert.equal(update({ folder: "INBOX " }).cursorResetRequired, false);
  assert.equal(resolveMailboxUpdate(existingConfig({ folder: "" }), {}).cursorResetRequired, false);
});

test("D.4 游标重置: 同一份配置原样提交不重置（编辑器点一次保存不该丢基线）", () => {
  const { config, cursorResetRequired } = resolveMailboxUpdate(existingConfig(), {
    name: existingConfig().name,
    email: existingConfig().email,
    username: existingConfig().username,
    password: "",
    imapHost: existingConfig().imapHost,
    imapPort: existingConfig().imapPort,
    imapSecure: existingConfig().imapSecure,
    folder: existingConfig().folder,
  });

  assert.deepEqual(config, existingConfig());
  assert.equal(cursorResetRequired, false);
});

test("编辑校验: 合并后的配置仍按创建时的规则校验，非法取值抛可识别的错误码", () => {
  assert.throws(() => update({ email: "not-an-email" }), /MAILBOX_EMAIL_INVALID/);
  assert.throws(() => update({ imapHost: "" }), /MAILBOX_IMAP_HOST_REQUIRED/);
  assert.throws(() => update({ imapPort: 0 }), /MAILBOX_IMAP_PORT_INVALID/);
  assert.throws(() => update({ imapPort: 70000 }), /MAILBOX_IMAP_PORT_INVALID/);
});

test("创建路径: 归一化后端口默认 993、文件夹默认 INBOX、名称回落到邮箱", () => {
  const config = normalizeMailboxConfig({
    email: "sales@corp.com",
    password: "code",
    imapHost: "imap.corp.com",
  });

  assert.equal(config.imapPort, 993);
  assert.equal(config.imapSecure, true);
  assert.equal(config.folder, "INBOX");
  assert.equal(config.name, "sales@corp.com");
  assert.equal(config.username, "sales@corp.com");
});

test("创建路径: 缺少密码或主机时拒绝，不静默补默认值", () => {
  assert.throws(
    () =>
      normalizeMailboxConfig({ email: "sales@corp.com", password: "", imapHost: "imap.corp.com" }),
    /MAILBOX_PASSWORD_REQUIRED/
  );
  assert.throws(
    () => normalizeMailboxConfig({ email: "sales@corp.com", password: "code", imapHost: " " }),
    /MAILBOX_IMAP_HOST_REQUIRED/
  );
});

test("编辑请求体: 只收下出现过的字段，缺口不补默认值（否则只改密码会顺带改写主机/文件夹）", () => {
  const input = mailboxUpdateInputFromBody({ password: "new-code" });

  assert.deepEqual(Object.keys(input), ["password"]);
});

test("编辑请求体: 密码「未提供」与「空串」必须能区分——前者不下发该字段，后者原样下发", () => {
  assert.deepEqual(mailboxUpdateInputFromBody({ name: "改名" }), { name: "改名" });
  assert.deepEqual(mailboxUpdateInputFromBody({ name: "改名", password: "" }), {
    name: "改名",
    password: "",
  });
});

test("编辑请求体: 端口数字与数字串都收，空串/null 视为未提供；非数字留给服务端报 400", () => {
  assert.equal(mailboxUpdateInputFromBody({ imapPort: 143 }).imapPort, 143);
  assert.equal(mailboxUpdateInputFromBody({ imapPort: "143" }).imapPort, 143);
  assert.equal("imapPort" in mailboxUpdateInputFromBody({ imapPort: "" }), false);
  assert.equal("imapPort" in mailboxUpdateInputFromBody({ imapPort: null }), false);
  assert.equal(Number.isNaN(mailboxUpdateInputFromBody({ imapPort: "abc" }).imapPort), true);
});

test("编辑请求体: imapSecure 只收布尔；非文本字段与非法 body 一律忽略", () => {
  assert.deepEqual(mailboxUpdateInputFromBody({ imapSecure: false }), { imapSecure: false });
  assert.equal("imapSecure" in mailboxUpdateInputFromBody({ imapSecure: "false" }), false);
  assert.deepEqual(mailboxUpdateInputFromBody({ name: 123, email: null }), {});
  assert.deepEqual(mailboxUpdateInputFromBody(null), {});
  assert.deepEqual(mailboxUpdateInputFromBody("not-an-object"), {});
  assert.deepEqual(mailboxUpdateInputFromBody(undefined), {});
});

test("编辑请求是否带新密码：空串与未提供都算「没带」，与 resolveMailboxUpdate 同一判定", () => {
  assert.equal(mailboxUpdateSuppliesPassword({ password: "new-auth-code" }), true);
  assert.equal(mailboxUpdateSuppliesPassword({ password: "  " }), true);
  assert.equal(mailboxUpdateSuppliesPassword({ password: "" }), false);
  assert.equal(mailboxUpdateSuppliesPassword({ name: "只改名" }), false);
  assert.equal(mailboxUpdateSuppliesPassword(undefined), false);
  assert.equal(mailboxUpdateSuppliesPassword(null), false);
});

test("带新密码的编辑不去解密旧密文（否则密钥被换过后用户永远自救不了）", () => {
  // 密钥轮换后旧密文必然解不开，而用户此刻提交的正是"重新填写授权码"这件事本身：
  // 若在合并前先解密旧密文，接口会一直报「凭据已失效」，用户照提示重填还是同一条错误。
  const source = readFileSync(join(process.cwd(), "lib/automation/mailboxes.ts"), "utf8");

  assert.match(
    source,
    /mailboxConnectionFromRow\(\s*existingRow\s*,\s*mailboxUpdateSuppliesPassword\(input\)\s*\?/,
    "更新路径必须按「请求是否带新密码」决定要不要解密既有密文"
  );
});
