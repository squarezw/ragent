/**
 * 监听邮箱连接失败的状态与提醒（模块 E.1 状态列 / E.2 提醒派生）。
 *
 * 核心是一条**前端依赖的契约**：提醒的 `eventKey` 恰好是 `mailbox-error:<mailboxId>`。
 * 加时间戳（"每次失败一条"）会让页面按 eventKey 去重的 toast 反复弹窗，也会让"邮箱恢复前
 * 只有一条稳定提醒"这条性质消失，所以这里断言的是**字符串相等**，不是"包含前缀"。
 *
 * 另有三组属于"跑不了就钉源码"（`lib/automation/mailboxes.ts`、`store.ts`、
 * `automation-scheduler.ts` 都依赖 `lib/db`，本套件不连数据库、也不 import `@/lib`）。
 * 每一组都有一个"写错了不会有类型错误、只会在运行时出问题"的坑：
 * - `ensureAutomationTables()` 里给 automation_mailboxes 加列：这张表由 mailboxes.ts
 *   按需创建，首次部署时可能还不存在，裸跑 ALTER 会 42P01；而该函数失败会重置 initPromise，
 *   于是每一次 store 调用都重跑整段 SQL 并再次失败。
 * - 提醒的第三段派生必须来自 automation_mailboxes 且带 `status='error'`：少了状态过滤，
 *   所有邮箱都会变成"连接失败"。
 * - 状态写入必须挂在真实的连接路径上（连不上记 error、连上了恢复 connected），
 *   否则徽标永远是装饰、`status='error'` 永远没有行。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mailboxErrorDisplayText } from "../lib/automation/mailbox-errors.ts";
import {
  MAILBOX_ERROR_EVENT_KEY_PREFIX,
  MAILBOX_ERROR_MAX_LENGTH,
  mailboxErrorEventKey,
  mailboxErrorNotificationItems,
  mailboxErrorText,
  type MailboxErrorRow,
} from "../lib/automation/mailbox-health.ts";

const STORE = join(process.cwd(), "lib/automation/store.ts");
const MAILBOXES = join(process.cwd(), "lib/automation/mailboxes.ts");
const SCHEDULER = join(process.cwd(), "lib/cron/automation-scheduler.ts");

/** 去掉注释：注释里可以提旧写法，可执行 SQL / 代码里不允许。 */
function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** 源码里所有「像 SQL」的反引号模板串。 */
function sqlStatements(source: string): string[] {
  return [...withoutComments(source).matchAll(/`([^`]*)`/g)]
    .map((match) => match[1])
    .filter((text) => /\b(SELECT|UPDATE|DELETE|INSERT|CREATE|ALTER)\b/i.test(text));
}

/** 按花括号配对取出函数体（不依赖"它是文件里最后一个函数"这种脆弱前提）。 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `找不到函数 ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, index + 1);
    }
  }
  throw new Error(`函数 ${name} 的花括号不配对`);
}

function errorItem(overrides: Partial<MailboxErrorRow> = {}) {
  const [item] = mailboxErrorNotificationItems([
    {
      mailboxId: 7,
      label: "销售部邮箱 · sales@corp.com",
      error: "认证失败：用户名或授权码不正确",
      errorAt: "2026-09-11T02:00:00.000Z",
      ...overrides,
    },
  ]);
  return item;
}

test("eventKey 恰好是 mailbox-error:<mailboxId>，不含时间戳", () => {
  assert.equal(MAILBOX_ERROR_EVENT_KEY_PREFIX, "mailbox-error:");
  assert.equal(mailboxErrorEventKey(7), "mailbox-error:7");
  assert.equal(mailboxErrorEventKey(1024), "mailbox-error:1024");
  // 派生的提醒条目用的是同一个字符串，不是另写一份拼接。
  assert.equal(errorItem().eventKey, "mailbox-error:7");
});

test("同一邮箱多次失败只派生一条 eventKey 相同的提醒（失败时刻不影响 eventKey）", () => {
  const first = errorItem({ errorAt: "2026-09-11T02:00:00.000Z", error: "连接超时" });
  const second = errorItem({ errorAt: "2026-09-11T09:30:00.000Z", error: "认证失败" });

  assert.equal(first.eventKey, second.eventKey);
  assert.equal(first.eventKey, `mailbox-error:7`);
  assert.notEqual(first.createdAt, second.createdAt, "提醒时间会更新，但事件标识不变");
});

test("邮箱恢复后不再有 error 行时，派生结果为空（提醒消失是结构性的）", () => {
  // 恢复 = 该邮箱不再是 status='error' 的查询结果，因此这里根本没有行可传。
  assert.deepEqual(mailboxErrorNotificationItems([]), []);
  assert.deepEqual(mailboxErrorNotificationItems([], new Date("2026-09-11T00:00:00Z")), []);
});

test("提醒复用 email_failed、level 为 strong、不指向任何运行记录", () => {
  const item = errorItem();

  assert.equal(item.kind, "email_failed");
  assert.equal(item.level, "strong");
  // 连接失败发生在建 Run 之前：runId 0 表示没有对应运行，automationId 为 null（一条管道
  // 可能被多个自动化共用）。前端据此不会打开一个不存在的运行详情。
  assert.equal(item.runId, 0);
  assert.equal(item.automationId, null);
  assert.equal(item.read, false);
});

test("提醒文案带上邮箱展示名与错误原文", () => {
  const item = errorItem();

  assert.ok(item.title.includes("销售部邮箱 · sales@corp.com"), item.title);
  assert.ok(item.message.includes("认证失败：用户名或授权码不正确"), item.message);
});

test("错误原文过长会截断，提醒不会变成一大段日志", () => {
  const long = "上游报错".repeat(500);
  const item = errorItem({ error: long });

  assert.ok(item.message.length < 400, `提醒文案过长：${item.message.length}`);
  assert.ok(item.message.endsWith("…"));
  assert.equal(
    mailboxErrorText(`  ${long}  `, MAILBOX_ERROR_MAX_LENGTH).length,
    MAILBOX_ERROR_MAX_LENGTH + 1
  );
});

test("没有错误原文时给出可操作的兜底文案", () => {
  const item = errorItem({ error: "" });

  assert.ok(!item.message.includes("："), item.message);
  assert.ok(item.message.includes("邮箱管理"), item.message);
});

test("错误时间为空或非法时退回当前时间，且不产生 NaN 时间戳", () => {
  const now = new Date("2026-09-11T12:00:00.000Z");
  assert.equal(
    mailboxErrorNotificationItems([{ mailboxId: 3 }], now)[0].createdAt,
    now.toISOString()
  );
  assert.equal(
    mailboxErrorNotificationItems([{ mailboxId: 3, errorAt: "not-a-date" }], now)[0].createdAt,
    now.toISOString()
  );
});

test("邮箱 id 非法的行不派生提醒（不会拼出 mailbox-error:NaN）", () => {
  const items = mailboxErrorNotificationItems([
    { mailboxId: Number.NaN },
    { mailboxId: 0 },
    { mailboxId: -1 },
    {} as { mailboxId: number },
    { mailboxId: 5 },
  ]);

  assert.deepEqual(
    items.map((item) => item.eventKey),
    ["mailbox-error:5"]
  );
});

test("加列的 ALTER 包在「表存在」判断里，且可重复执行（E.1）", () => {
  const statements = sqlStatements(readFileSync(STORE, "utf8"));
  const withAlter = statements.filter((sql) => /ADD COLUMN IF NOT EXISTS last_error/i.test(sql));
  assert.equal(
    withAlter.length,
    1,
    `期望恰好一段给 last_error 加列的 SQL，实际 ${withAlter.length} 段`
  );
  const sql = withAlter[0];

  assert.match(sql, /ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ/i);
  assert.match(sql, /ALTER TABLE automation_mailboxes/i);

  // ALTER 所在的那个 DO 块必须先判断表存在：automation_mailboxes 由 mailboxes.ts 按需创建，
  // 首次部署时可能还不存在，裸跑 ALTER 会以 42P01 失败——而 ensureAutomationTables 失败后会
  // 重置 initPromise，于是每一次 store 调用都重跑整段并再次失败。
  const alterAt = sql.indexOf("ADD COLUMN IF NOT EXISTS last_error");
  const doStart = sql.lastIndexOf("DO $$", alterAt);
  assert.ok(doStart >= 0, "ALTER 必须写在 DO 块里，否则无法做存在性判断");
  const guardedBlock = sql.slice(doStart, sql.indexOf("END $$;", alterAt));

  assert.match(guardedBlock, /information_schema\.tables/);
  assert.match(guardedBlock, /IF EXISTS/);
  assert.match(guardedBlock, /table_name = 'automation_mailboxes'/);
});

test("邮箱列表接口下发 lastError（抽屉「最后错误」的唯一数据源）", () => {
  const source = readFileSync(MAILBOXES, "utf8");

  assert.match(functionBody(source, "mailboxRowToApi"), /lastError:\s*row\.last_error/);
  assert.match(functionBody(source, "mailboxRowToApi"), /lastErrorAt:\s*row\.last_error_at/);
});

test("错误码在落库/展示前换成用户可读文案，而不是裸错误码", () => {
  // 凭据失效（模块 E.3：密钥被换过）与密钥未配置都是"已知原因"，用户看到的是该怎么办。
  assert.equal(
    mailboxErrorDisplayText(new Error("MAILBOX_CREDENTIAL_INVALID")),
    "邮箱凭据已失效，请重新填写授权码或密码"
  );
  assert.equal(
    mailboxErrorDisplayText(new Error("AUTOMATION_MAILBOX_SECRET_MISSING")),
    "服务端尚未配置邮箱凭证加密密钥"
  );
  // 上游 IMAP 失败带回的是真实原因，不在表里，原样保留（改写只会丢信息）。
  assert.equal(mailboxErrorDisplayText(new Error("登录失败: 授权码错误")), "登录失败: 授权码错误");
  assert.equal(mailboxErrorDisplayText(undefined), "");
});

test("连接失败写库前先做映射（否则通知与「最后错误」会显示 MAILBOX_CREDENTIAL_INVALID）", () => {
  const body = functionBody(
    readFileSync(MAILBOXES, "utf8"),
    "markAutomationMailboxConnectionError"
  );

  assert.match(
    body,
    /mailboxErrorDisplayText\(/,
    "last_error 是抽屉「最后错误」与通知中心的同一份文案来源，裸错误码必须在写入前翻译掉"
  );
});

test("状态写入挂在真实连接路径上：连不上记 error，连上了恢复 connected（E.1）", () => {
  const source = readFileSync(SCHEDULER, "utf8");
  const fetchBody = functionBody(source, "fetchConfiguredMailboxUnread");

  assert.match(fetchBody, /fetchMailboxUnread\(/);
  assert.match(fetchBody, /markAutomationMailboxConnectionError\(/);
  assert.match(fetchBody, /markAutomationMailboxConnected\(/);

  // 记录失败不能把原始错误吞掉：错误必须继续往上抛，分组层才会照旧打日志。
  assert.match(fetchBody, /catch[\s\S]{0,400}throw error;/);
  // 恢复只在"当前不是 connected"时写库，正常轮询不产生写入。
  assert.match(fetchBody, /status !== "connected"/);
});

test("提醒的第三段派生来自 automation_mailboxes 且只取 status='error'（E.2）", () => {
  const source = readFileSync(STORE, "utf8");
  const body = functionBody(source, "listAutomationNotifications");

  const mailboxQueries = sqlStatements(body).filter((sql) =>
    /\bFROM\s+automation_mailboxes\b/i.test(sql)
  );
  assert.equal(
    mailboxQueries.length,
    1,
    `期望提醒派生里恰好有一段查 automation_mailboxes 的语句，实际 ${mailboxQueries.length} 段`
  );

  const query = mailboxQueries[0];
  assert.match(query, /status\s*=\s*'error'/i, "少了状态过滤，所有邮箱都会变成「连接失败」提醒");
  assert.match(query, /created_by_user_id\s*=\s*\$\d/, "只取当前用户自己的邮箱");
  assert.match(query, /last_error/, "提醒要能说明失败原因");
  assert.match(
    body,
    /mailboxErrorNotificationItems\(/,
    "派生结果必须经 mailbox-health.ts 生成，eventKey 的格式才有单一来源"
  );
  // initialize 通知偏好之前就坏掉的邮箱同样该被看到：这是"当前状态"，不是历史事件。
  assert.doesNotMatch(query, /initializedAt|initialized_at/);
});
