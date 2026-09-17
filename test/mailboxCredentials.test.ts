/**
 * 邮箱凭据加解密（spec §七：`lib/automation/mailboxes.ts` 加解密往返）。
 *
 * 这里断言的是真实行为：密文能解回原文、篡改与换密钥都会失败。做成"对着 mock 断言"
 * 的话，把加密函数整个换成明文存储也照样通过。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decryptMailboxPassword,
  encryptMailboxPassword,
} from "../lib/automation/mailbox-credentials.ts";

const SECRET = "test-secret";

test("加解密往返: 密文能解回原文", () => {
  const plaintext = "auth-code-1234";
  const ciphertext = encryptMailboxPassword(SECRET, plaintext);

  assert.notEqual(ciphertext, plaintext);
  assert.equal(decryptMailboxPassword(SECRET, ciphertext), plaintext);
});

test("加解密往返: 中文、空格与超长授权码原样往返", () => {
  const samples = [
    "授权码 abc 123",
    " pass with leading and trailing space ",
    "x".repeat(2000),
    "密码含:冒号与,逗号",
  ];

  for (const plaintext of samples) {
    assert.equal(
      decryptMailboxPassword(SECRET, encryptMailboxPassword(SECRET, plaintext)),
      plaintext
    );
  }
});

test("加密: 同一明文两次加密得到不同密文（IV 随机），且都能解开", () => {
  const first = encryptMailboxPassword(SECRET, "same-password");
  const second = encryptMailboxPassword(SECRET, "same-password");

  assert.notEqual(first, second);
  assert.equal(decryptMailboxPassword(SECRET, first), "same-password");
  assert.equal(decryptMailboxPassword(SECRET, second), "same-password");
});

test("加密: 密文里不含明文", () => {
  const stem = "very-distinctive-secret-value";
  assert.equal(encryptMailboxPassword(SECRET, stem).includes(stem), false);
});

test("解密: 换密钥会失败，而不是返回错误明文", () => {
  const ciphertext = encryptMailboxPassword("secret-a", "auth-code");

  assert.throws(
    () => decryptMailboxPassword("secret-b", ciphertext),
    (error: Error) => error.message === "MAILBOX_CREDENTIAL_INVALID",
    "密钥不符时必须抛可识别的错误码：Node 抛的是 " +
      "「Unsupported state or unable to authenticate data」，它既不在接口错误映射表里、" +
      "也不在连接失败启发式里，会一路落成 500。而模块 E.3 说的正是这个场景——" +
      "轮换密钥后所有已存凭据失效，用户需要看到「请重新填写授权码」并且真的能重填。"
  );
});

test("解密: 密文被篡改会失败（AES-GCM 认证标签）", () => {
  const ciphertext = encryptMailboxPassword(SECRET, "auth-code");
  const [version, iv, tag, body] = ciphertext.split(":");
  const tamperedBody = Buffer.from(body, "base64");
  tamperedBody[0] = (tamperedBody[0] + 1) % 256;

  const tampered = [version, iv, tag, tamperedBody.toString("base64")].join(":");
  assert.throws(
    () => decryptMailboxPassword(SECRET, tampered),
    (error: Error) => error.message === "MAILBOX_CREDENTIAL_INVALID"
  );
});

test("解密: 格式非法时抛可识别的错误码，而不是静默返回空串", () => {
  const invalid = ["", "auth-code-plain-text", "v2:a:b:c", "v1:onlyiv:onlytag", "v1::tag:body"];

  for (const value of invalid) {
    assert.throws(
      () => decryptMailboxPassword(SECRET, value),
      /MAILBOX_CREDENTIAL_INVALID/,
      `期望 ${JSON.stringify(value)} 被判为无效凭据`
    );
  }
});
