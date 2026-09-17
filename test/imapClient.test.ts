/**
 * IMAP 收信的纯逻辑守卫（收信链路现在实现于 ragent 进程内，不再打 ragent-service）。
 *
 * 这里钉住的是移植过程中最容易写反、而写反之后**不会报错、只会静默错**的几处：
 *
 * - `latest_uid` 是「文件夹当前最大 UID」（空文件夹为 0），**不是**「本批返回里最大的那个」。
 *   取小了，下次轮询就会把历史邮件重新处理一遍；首次运行时调用方正是拿它建基线的。
 * - 一批取「游标之后**最早**的 20 封」。取最新 20 封时，逐封推进的游标会一次跳过中间
 *   所有邮件，而这些邮件再也不会被读到——静默丢信（`patch_backend_mail_batch.py` 修的就是它）。
 * - 正文纯文本优先、HTML 兜底：HTML-only 邮件若被当成纯文本（或反过来把 HTML 源码
 *   当成纯文本返回），`开头是`/`等于` 类规则会拿标签去匹配。
 *
 * 本文件不连网、不连库：纯函数直接喂参数，解析类用构造出来的 RFC822 报文喂 `mailparser`。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  ATTACHMENT_MAX_FILE_BYTES,
  IMAP_MESSAGE_BATCH_SIZE,
  IMAP_TIMEOUT_MS,
  extractAttachmentNames,
  extractBody,
  imapFailureMessage,
  parseAttachmentFiles,
  parseInboxMessage,
  planMailboxFetch,
  rawHeaderValue,
  splitAttachmentsBySize,
  toAttachmentFiles,
  toInboxMessage,
  uidsFromSearchResult,
} from "../lib/automation/imap-client.ts";

const IMAP_CLIENT = join(process.cwd(), "lib/automation/imap-client.ts");

/**
 * 去掉注释后再断言源码：注释里会**引用**被禁止的写法（正是那些注释在解释为什么不能那么写），
 * 不剥掉的话守卫会被自己的说明文字满足——`readOnly: true` 就同时出现在文档注释里。
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** 拼一封原始报文：头部 + 空行 + 正文，用 CRLF（与真实 SMTP 一致）。 */
function rawMessage(headers: string[], body: string): Buffer {
  return Buffer.from([...headers, "", body].join("\r\n"), "utf8");
}

const PLAIN_ONLY = rawMessage(
  [
    "From: =?utf-8?B?5byg5LiJ?= <sales@corp.com>",
    "To: Bot <bot@corp.com>",
    "Subject: 月度报表",
    "Message-ID: <plain-1@corp.com>",
    "Date: Mon, 1 Sep 2025 10:00:00 +0800",
    "Content-Type: text/plain; charset=utf-8",
  ],
  "纯文本正文"
);

const HTML_ONLY = rawMessage(
  ["From: a@corp.com", "Subject: html only", "Content-Type: text/html; charset=utf-8"],
  "<p>Hello <b>World</b></p>"
);

const ALTERNATIVE = rawMessage(
  [
    "From: a@corp.com",
    "Subject: alternative",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="ALT"',
  ],
  [
    "--ALT",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "纯文本版本",
    "--ALT",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>HTML 版本</p>",
    "--ALT--",
    "",
  ].join("\r\n")
);

const MIXED = rawMessage(
  [
    "From: a@corp.com",
    "Subject: mixed",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="MIX"',
  ],
  [
    "--MIX",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "第一段正文",
    "--MIX",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "第二段正文",
    "--MIX",
    // 带 attachment 处置的纯文本 part：是附件，不能进正文。
    "Content-Type: text/plain; charset=utf-8",
    'Content-Disposition: attachment; filename="notes.txt"',
    "",
    "这段是附件正文，不该出现在正文里",
    "--MIX",
    // inline 但带 filename：也要算附件。
    'Content-Type: image/png; name="inline.png"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: inline; filename="inline.png"',
    "",
    "aGVsbG8=",
    "--MIX",
    // 有 Content-ID 但没有 filename 的裸图片：不算附件。
    "Content-Type: image/gif",
    "Content-Transfer-Encoding: base64",
    "Content-ID: <nofilename@corp.com>",
    "",
    "R0lGODlh",
    "--MIX",
    // 文件名是 RFC2047 编码的：必须解码后再返回。
    "Content-Type: application/pdf",
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="=?utf-8?B?5oql5ZGKLnBkZg==?="',
    "",
    "aGVsbG8=",
    "--MIX--",
    "",
  ].join("\r\n")
);

const BARE = rawMessage(["Content-Type: text/plain; charset=us-ascii"], "没有头部的一封信");

/**
 * 两封"带文件名、但 `mailparser` 不把它当附件"的报文。参考实现（Python `msg.walk()` +
 * `part.get_filename()`）会报出这些名字，本实现不会——见 `extractAttachmentNames` 的说明。
 * 下面两例断言的是**当前、已被记录的**行为，不是期望行为：改判定就会翻红。
 */
const INLINE_NAMED = rawMessage(
  [
    "From: a@corp.com",
    "Subject: inline named",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="NAMED"',
  ],
  [
    "--NAMED",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "正文",
    "--NAMED",
    // 带 filename 的 inline 正文 part：mailparser 判为正文，不报成附件。
    "Content-Type: text/html; charset=utf-8",
    'Content-Disposition: inline; filename="page.html"',
    "",
    "<p>名义上的附件</p>",
    "--NAMED",
    // 只有 Content-Type 的 name 参数、没有 disposition：Python 的 get_filename() 会兜底到它。
    'Content-Type: text/plain; charset=utf-8; name="notes.txt"',
    "",
    "第二段正文",
    "--NAMED--",
    "",
  ].join("\r\n")
);

const FORWARDED = rawMessage(
  [
    "From: a@corp.com",
    "Subject: forwarded",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="FWD"',
  ],
  [
    "--FWD",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "请看转发",
    "--FWD",
    // 转发邮件（容器无 disposition → 不透明）：内层的 inner.pdf 看不到；容器也没有 filename，
    // 于是整条被 filename 过滤掉。"不透明"来自 mailsplit 只对 inline 的 message/rfc822 分叉。
    "Content-Type: message/rfc822",
    "",
    "From: inner@corp.com",
    "Subject: inner",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="INNER"',
    "",
    "--INNER",
    "Content-Type: text/plain",
    "",
    "内层正文",
    "--INNER",
    "Content-Type: application/pdf",
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="inner.pdf"',
    "",
    "aGVsbG8=",
    "--INNER--",
    "",
    "--FWD",
    // 容器自己带 filename（attachment → 依然不透明）：能看到的就是这一层。
    "Content-Type: message/rfc822",
    'Content-Disposition: attachment; filename="forwarded.eml"',
    "",
    "From: inner2@corp.com",
    "Subject: inner2",
    "",
    "内层正文二",
    "--FWD--",
    "",
  ].join("\r\n")
);

test("latest_uid 取文件夹当前最大 UID，空文件夹为 0", () => {
  assert.equal(planMailboxFetch([]).latestUid, 0);
  assert.equal(planMailboxFetch([3, 9, 7]).latestUid, 9);
  assert.equal(planMailboxFetch([3, 9, 7], 4).latestUid, 9);
});

test("首次轮询只建基线：不传 afterUid 时给 latest_uid、一封都不取", () => {
  const plan = planMailboxFetch([5, 6, 7]);

  // 返回 0 会让下次轮询把历史邮件全部重放；返回批次里的最大值则漏掉基线之上的那部分。
  assert.equal(plan.latestUid, 7);
  assert.deepEqual(plan.targetUids, []);
});

test("afterUid 为空值（undefined / null）与不传等价", () => {
  for (const value of [undefined, null]) {
    assert.equal(planMailboxFetch([5, 6, 7], value).latestUid, 7);
    assert.deepEqual(planMailboxFetch([5, 6, 7], value).targetUids, []);
  }
});

test("一批取游标之后最早的 20 封，不是最新 20 封", () => {
  assert.equal(IMAP_MESSAGE_BATCH_SIZE, 20);

  const uids = Array.from({ length: 25 }, (_, index) => index + 1);
  assert.deepEqual(
    planMailboxFetch(uids, 0).targetUids,
    Array.from({ length: 20 }, (_, index) => index + 1)
  );

  // 积压 25 封、游标停在 3：这一批必须是 4..23，剩下的 24、25 留给下一批。
  assert.deepEqual(
    planMailboxFetch(uids, 3).targetUids,
    Array.from({ length: 20 }, (_, index) => index + 4)
  );
});

test("search 没返回数组时直接失败，绝不当作空文件夹", () => {
  // 当作空文件夹 → 基线调用写下游标 0 → 下次轮询把整个邮箱的历史重放一遍。
  assert.throws(() => uidsFromSearchResult(false), /IMAP/);
  assert.throws(() => uidsFromSearchResult(undefined), /IMAP/);
  assert.throws(() => uidsFromSearchResult({}), /IMAP/);

  assert.deepEqual(uidsFromSearchResult([]), []);
  assert.deepEqual(uidsFromSearchResult([3, 1]), [3, 1]);
  // imapflow 给的是数字；字符串型 UID 也要能用（顺带钉住 map(Number)）。
  assert.deepEqual(uidsFromSearchResult(["7"]), [7]);
});

test("只取 uid 大于游标的邮件，并按升序返回", () => {
  assert.deepEqual(planMailboxFetch([9, 4, 7, 5], 5).targetUids, [7, 9]);
  assert.deepEqual(planMailboxFetch([2, 2, 3], 1).targetUids, [2, 2, 3]);
});

test("正文纯文本优先：同一封邮件里同时有纯文本与 HTML 时取纯文本", () => {
  assert.equal(extractBody({ text: "纯文本正文", html: "<p>HTML 正文</p>" }), "纯文本正文");
});

test("HTML-only 邮件回落到 HTML 源码（而不是被转换过的文本）", async () => {
  const message = await parseInboxMessage(1, HTML_ONLY);
  assert.equal(message.body, "<p>Hello <b>World</b></p>");
});

test("正文：没有可读 part 时是空串，不是 undefined", () => {
  assert.equal(extractBody({}), "");
  assert.equal(extractBody({ text: "   ", html: "" }), "");
  assert.equal(extractBody({ text: undefined, html: undefined }), "");
});

test("解析真实报文：跳过附件 part，多个纯文本 part 用换行连接", async () => {
  const message = await parseInboxMessage(11, MIXED);

  assert.equal(message.body, "第一段正文\n第二段正文");
});

test("解析真实报文：multipart/alternative 取纯文本那一支", async () => {
  const message = await parseInboxMessage(12, ALTERNATIVE);
  assert.equal(message.body, "纯文本版本");
});

test("附件名提取：任何带 filename 的 part 都算（inline 也算），没有 filename 的不算", async () => {
  const message = await parseInboxMessage(11, MIXED);

  assert.deepEqual(message.attachments, ["notes.txt", "inline.png", "报告.pdf"]);
});

test("附件名提取的兜底：只有非空字符串文件名才算数", () => {
  assert.deepEqual(
    extractAttachmentNames({
      attachments: [{ filename: "报表.pdf" }, { contentType: "image/gif" }, { filename: "" }],
    }),
    ["报表.pdf"]
  );
  assert.deepEqual(extractAttachmentNames({ attachments: undefined }), []);
  assert.deepEqual(extractAttachmentNames({}), []);
});

test("附件内容提取：文件名、字节、类型、大小都对得上，且与附件名同序", async () => {
  const files = await parseAttachmentFiles(MIXED);

  // 与 extractAttachmentNames 完全同名同序——两者判定一旦分叉，规则命中的附件
  // 与实际传给数字员工的附件就会对不上。
  assert.deepEqual(
    files.map((file) => file.filename),
    ["notes.txt", "inline.png", "报告.pdf"]
  );

  assert.equal(files[0].content.toString("utf8"), "这段是附件正文，不该出现在正文里");
  assert.equal(files[0].contentType, "text/plain");
  assert.equal(files[0].size, Buffer.byteLength("这段是附件正文，不该出现在正文里"));

  // inline 图片：base64 "aGVsbG8=" 解码后是 hello
  assert.equal(files[1].content.toString("utf8"), "hello");
  assert.equal(files[1].contentType, "image/png");
  assert.equal(files[1].size, 5);

  // 文件名是 RFC2047 编码的那个 pdf
  assert.equal(files[2].filename, "报告.pdf");
  assert.equal(files[2].content.toString("utf8"), "hello");
});

test("附件内容提取：拿不到字节的 part 直接跳过，不会留一个空壳", () => {
  const files = toAttachmentFiles({
    attachments: [
      { filename: "有内容.pdf", content: Buffer.from("abc"), contentType: "application/pdf" },
      { filename: "没内容.pdf" },
      { filename: "" },
      { contentType: "image/gif", content: Buffer.from("x") },
    ],
  });

  assert.deepEqual(
    files.map((file) => file.filename),
    ["有内容.pdf"]
  );
  assert.equal(files[0].size, 3);
});

test("附件内容提取：没有附件的邮件返回空数组", () => {
  assert.deepEqual(toAttachmentFiles({}), []);
  assert.deepEqual(toAttachmentFiles({ attachments: undefined }), []);
});

test("超限附件被挑出来而不是被丢掉：跳过的那些要能在提示词里点名", () => {
  const files = [
    { filename: "小.xlsx", content: Buffer.alloc(10), contentType: "application/x", size: 10 },
    {
      filename: "刚好到上限.xlsx",
      content: Buffer.alloc(ATTACHMENT_MAX_FILE_BYTES),
      contentType: "application/x",
      size: ATTACHMENT_MAX_FILE_BYTES,
    },
    {
      filename: "超了.xlsx",
      content: Buffer.alloc(ATTACHMENT_MAX_FILE_BYTES + 1),
      contentType: "application/x",
      size: ATTACHMENT_MAX_FILE_BYTES + 1,
    },
  ];

  const { accepted, skipped } = splitAttachmentsBySize(files);

  // 边界取「不超过」：恰好等于上限的要传，否则上限就比标称值小了一字节。
  assert.deepEqual(
    accepted.map((file) => file.filename),
    ["小.xlsx", "刚好到上限.xlsx"]
  );
  assert.deepEqual(
    skipped.map((file) => file.filename),
    ["超了.xlsx"]
  );
});

test("上限可注入：便于测试与将来按部署调整", () => {
  const files = [
    { filename: "a.pdf", content: Buffer.alloc(5), contentType: "application/pdf", size: 5 },
    { filename: "b.pdf", content: Buffer.alloc(50), contentType: "application/pdf", size: 50 },
  ];

  const { accepted, skipped } = splitAttachmentsBySize(files, 10);

  assert.deepEqual(
    accepted.map((file) => file.filename),
    ["a.pdf"]
  );
  assert.deepEqual(
    skipped.map((file) => file.filename),
    ["b.pdf"]
  );
});

test("被判成正文的 part 不计入附件（已记录的偏差，改判定即翻红）", async () => {
  const message = await parseInboxMessage(21, INLINE_NAMED);

  assert.deepEqual(message.attachments, []);
  // 顺带钉住"它们去哪了"：两个 part 都没丢，只是归类不同。`name="notes.txt"` 那一段被当成
  // 正文，就在返回值里；`filename="page.html"` 那一段进了 HTML 分支——正文此刻取的是纯文本，
  // 所以它不出现在返回值里，但它同样没有被算成附件。断言的是归类，不是空白字符。
  assert.match(message.body, /第二段正文/);
  assert.doesNotMatch(message.body, /名义上的附件/);
});

test("不带 disposition 的转发邮件内层不可见，容器带 filename 时才报容器（已记录的偏差）", async () => {
  const message = await parseInboxMessage(22, FORWARDED);

  // 这里两段容器都**不透明**（第一段无 disposition、第二段是 attachment），所以内层的
  // inner.pdf 看不到、参考实现的 msg.walk() 会看到。注意结论随容器的 disposition 而变：
  // `Content-Disposition: inline` 的容器是透明的（内层会报出来、容器自己的名字反而丢掉），
  // 本夹具没有覆盖那一种——判定规则见 extractAttachmentNames 的注释。
  assert.deepEqual(message.attachments, ["forwarded.eml"]);
});

test("date 取原始头部文本（与参考实现一致），取不到时是空串", () => {
  const headerLines = [{ key: "date", line: "Date: Mon, 1 Sep 2025 10:00:00 +0800" }];

  assert.equal(rawHeaderValue(headerLines, "date"), "Mon, 1 Sep 2025 10:00:00 +0800");
  assert.equal(rawHeaderValue([{ key: "subject", line: "Subject: hi" }], "date"), "");
  assert.equal(rawHeaderValue([], "date"), "");
  assert.equal(rawHeaderValue(undefined, "date"), "");
});

test("8 个字段恒存在：缺失的头部一律是空串，不是 undefined", async () => {
  const message = await parseInboxMessage(42, BARE);

  assert.deepEqual(message, {
    uid: 42,
    message_id: "",
    from: "",
    to: "",
    subject: "",
    date: "",
    body: "没有头部的一封信",
    attachments: [],
  });
});

test("头部齐全时 8 个字段都带上解析后的值", async () => {
  const message = await parseInboxMessage(7, PLAIN_ONLY);

  assert.deepEqual(message, {
    uid: 7,
    message_id: "<plain-1@corp.com>",
    from: '"张三" <sales@corp.com>',
    to: '"Bot" <bot@corp.com>',
    subject: "月度报表",
    date: "Mon, 1 Sep 2025 10:00:00 +0800",
    body: "纯文本正文",
    attachments: [],
  });
});

test("规范化：解析结果为空对象时也只有空串，不会漏字段", () => {
  assert.deepEqual(toInboxMessage(3, {}), {
    uid: 3,
    message_id: "",
    from: "",
    to: "",
    subject: "",
    date: "",
    body: "",
    attachments: [],
  });
});

test("失败文案统一带 IMAP 前缀，否则命中不了连接类错误映射", () => {
  assert.equal(
    imapFailureMessage(new Error("connect ECONNREFUSED 127.0.0.1:993")),
    "IMAP 收件失败: connect ECONNREFUSED 127.0.0.1:993"
  );
  assert.match(imapFailureMessage("boom"), /IMAP/);
  assert.match(imapFailureMessage(undefined), /IMAP/);
});

test("文件夹只读打开：源码里不得出现任何写已读状态的调用", () => {
  const source = withoutComments(readFileSync(IMAP_CLIENT, "utf8"));

  assert.match(source, /readOnly:\s*true/);
  assert.doesNotMatch(source, /messageFlags(Add|Set|Remove)\(/);
});

test("连接超时 15 秒", () => {
  const source = withoutComments(readFileSync(IMAP_CLIENT, "utf8"));

  assert.equal(IMAP_TIMEOUT_MS, 15_000);
  assert.match(source, /connectionTimeout:\s*IMAP_TIMEOUT_MS/);
  assert.match(source, /greetingTimeout:\s*IMAP_TIMEOUT_MS/);
});

test("latest_uid 来自文件夹 UID 全集，且在游标判断之前取好", () => {
  const source = withoutComments(readFileSync(IMAP_CLIENT, "utf8"));

  const fromFolder = source.indexOf("latestUidFrom(uids)");
  const cursorCheck = source.indexOf("Number.isInteger(afterUid)");

  assert.ok(fromFolder >= 0, "latest_uid 必须来自文件夹 UID 全集（uid search ALL）");
  assert.ok(cursorCheck >= 0, "找不到游标判断");
  assert.ok(fromFolder < cursorCheck, "latest_uid 必须先算出来，游标判断只决定本批取哪些");
  // 「本批取到了什么」不得反过来决定 latest_uid：首次轮询本批是空的，那样会回报 0。
  assert.doesNotMatch(source, /latestUid\s*=\s*targetUids/);
});
