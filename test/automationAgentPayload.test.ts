/**
 * 自动化请求体的形状守卫。
 *
 * 抽成零依赖纯模块才测得到：`execute.ts` 依赖 `@/lib/chatSse`，而本套件用
 * `node --experimental-strip-types` 跑，解析不了 `@/` 别名（与 `mail-rules.ts` 同样的理由）。
 *
 * 这里钉住两件事：
 * - 附件元信息按 ragent-service 认的字段名下发——`lib/qaCore.ts` 的对话链路已经在用同一组
 *   名字（`object_key` / `filename` / `content_type` / `size`），自动化这条路必须对齐，
 *   否则后端取不回文件，模型还是读不到附件；
 * - **`object_key` 只能留在服务端**。它一旦出现在 messages 文本里，模型就等同于拿到了
 *   对象存储的任意读能力——这是对话链路已经定下的规矩，不能因为换了入口就松掉。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMAIL_BODY_MAX_CHARS,
  buildAutomationAgentPayload,
  buildEmailAutomationQuestion,
  normalizeEmailBody,
} from "../lib/automation/agent-payload.ts";

test("无附件时不带 attachments 字段，请求体与改造前一致", () => {
  const payload = buildAutomationAgentPayload({ question: "算一下总分", appId: 7 });

  assert.deepEqual(payload, {
    messages: [{ role: "user", content: "算一下总分" }],
    app_id: 7,
  });
});

test("附件按后端认的字段名下发：object_key / filename / content_type / size", () => {
  const payload = buildAutomationAgentPayload({
    question: "算一下总分",
    appId: 7,
    attachments: [
      {
        objectKey: "attachments/2026/09/abc-成绩单.xlsx",
        filename: "成绩单.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: 12345,
      },
    ],
  });

  assert.deepEqual(payload.attachments, [
    {
      object_key: "attachments/2026/09/abc-成绩单.xlsx",
      filename: "成绩单.xlsx",
      content_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 12345,
    },
  ]);
});

test("object_key 绝不出现在 messages 里：模型不该拿到对象存储的读能力", () => {
  const payload = buildAutomationAgentPayload({
    question: "读一下附件",
    appId: 7,
    attachments: [
      {
        objectKey: "attachments/2026/09/very-secret-key-成绩单.xlsx",
        filename: "成绩单.xlsx",
      },
    ],
  });

  assert.ok(
    !JSON.stringify(payload.messages).includes("very-secret-key"),
    "messages 里出现了 object_key —— 模型会因此拿到对象存储的任意读能力",
  );
});

test("没有 object_key 的附件不下发：后端取不回文件，发了也只是噪音", () => {
  const payload = buildAutomationAgentPayload({
    question: "读一下附件",
    appId: 7,
    attachments: [
      { objectKey: "", filename: "取不回的.pdf" },
      { objectKey: "attachments/ok.pdf", filename: "取得到的.pdf" },
    ],
  });

  assert.deepEqual(
    (payload.attachments as Array<{ filename: string }>).map((a) => a.filename),
    ["取得到的.pdf"],
  );
});

test("全部附件都取不回时，不带 attachments 字段而不是发一个空数组", () => {
  const payload = buildAutomationAgentPayload({
    question: "读一下附件",
    appId: 7,
    attachments: [{ objectKey: "", filename: "取不回的.pdf" }],
  });

  assert.ok(!("attachments" in payload));
});

test("提示词：没有附件时保持原样说「无」", () => {
  const question = buildEmailAutomationQuestion({
    task: "算一下总分",
    mailboxLabel: "sales@corp.com",
    subject: "测试",
    body: "正文",
  });

  assert.match(question, /附件：无/);
});

test("提示词：已传入的附件要说明在 inputs/ 里，并叫模型按文件名引用", () => {
  const question = buildEmailAutomationQuestion({
    task: "算一下总分",
    mailboxLabel: "sales@corp.com",
    subject: "测试",
    body: "正文",
    delivered: ["成绩单.xlsx"],
  });

  assert.match(question, /成绩单\.xlsx/);
  assert.match(question, /inputs\//);
});

test("提示词：没传成的附件必须点名，否则模型会把收到的当成全部", () => {
  const question = buildEmailAutomationQuestion({
    task: "算一下总分",
    mailboxLabel: "sales@corp.com",
    subject: "测试",
    body: "正文",
    delivered: ["小.xlsx"],
    skipped: ["太大.zip"],
  });

  assert.match(question, /太大\.zip/);
  assert.match(question, /未传入|没传|跳过/);
});

test("提示词：object_key 不出现——交给后端按结构化字段取文件", () => {
  const question = buildEmailAutomationQuestion({
    task: "算一下总分",
    mailboxLabel: "sales@corp.com",
    subject: "测试",
    body: "正文",
    delivered: ["成绩单.xlsx"],
  });

  assert.ok(
    !question.includes("object_key") && !question.includes("attachments/"),
    "提示词里出现了对象存储的 key",
  );
});

test("提示词：正文为空时说「无正文」，不是留白", () => {
  const question = buildEmailAutomationQuestion({
    task: "算一下总分",
    mailboxLabel: "sales@corp.com",
    subject: "测试",
    body: "   ",
  });

  assert.match(question, /（无正文）/);
});

test("提示词：超长正文截断到 20000 字符并注明", () => {
  const question = buildEmailAutomationQuestion({
    task: "算一下总分",
    mailboxLabel: "sales@corp.com",
    subject: "测试",
    body: "字".repeat(20001),
  });

  assert.match(question, /已截取前 20000 个字符/);
  assert.equal(question.includes("字".repeat(20001)), false);
});

test("正文规范化：空、纯空白、非字符串一律落到「无正文」", () => {
  for (const value of ["", "   ", "\n\t ", undefined, null, 123]) {
    assert.equal(normalizeEmailBody(value as unknown as string), "（无正文）");
  }
});

test("正文规范化：恰好到上限不截断，多一个字才截", () => {
  const exact = "字".repeat(EMAIL_BODY_MAX_CHARS);
  assert.equal(normalizeEmailBody(exact), exact);

  const truncated = normalizeEmailBody(`${exact}多`);
  assert.equal(truncated.startsWith(exact), true, "截断保留了前 20000 个字符");
  assert.match(truncated, /已截取前 20000 个字符/);
});

test("正文规范化：两端空白先去，避免正文里带一串空行", () => {
  assert.equal(normalizeEmailBody("  正文  \n\n"), "正文");
});
