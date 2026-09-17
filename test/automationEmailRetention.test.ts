/**
 * 邮件去重表的保留期（模块 E.4：`automation_email_processed_messages` 保留 30 天，每天清理一次）。
 *
 * 两件事：
 * 1. 截止时刻的计算——保留期在 JS 里算好再作为查询参数传下去，所以"保留多少天"是可断言的
 *    行为，而不是埋在 `INTERVAL '30 days'` 字符串里；
 * 2. "清理确实每天跑一次"——清理函数住在 store.ts、依赖 `lib/db`，测试进程 import 不到它，
 *    因此按仓库既有做法（`test/mailboxCursorSql.test.ts`、`test/skillsProxyQuery.test.ts`）
 *    读源码文本钉住：DELETE 只能碰去重这一张表、必须用参数化截止时刻、并且挂在一条
 *    每天执行的 node-cron 上（不另起计时器）。
 *
 * 为什么要盯住删除范围：这张表与游标表相邻，而游标（`GREATEST` 写回的高水位）一旦被误删或
 * 被一起清掉，后果是"历史邮件被重新处理"或"新邮件全部漏掉"，两种都很难在测试环境复现。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  EMAIL_PROCESSED_RETENTION_DAYS,
  emailProcessedRetentionCutoff,
} from "../lib/automation/retention.ts";

const STORE = join(process.cwd(), "lib/automation/store.ts");
const SCHEDULER = join(process.cwd(), "lib/cron/automation-scheduler.ts");

function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function sqlStatements(source: string): string[] {
  return [...withoutComments(source).matchAll(/`([^`]*)`/g)]
    .map((match) => match[1])
    .filter((text) => /\b(SELECT|UPDATE|DELETE|INSERT|CREATE|ALTER)\b/i.test(text));
}

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

test("保留期是 30 天", () => {
  assert.equal(EMAIL_PROCESSED_RETENTION_DAYS, 30);
  assert.equal(
    emailProcessedRetentionCutoff(new Date("2026-09-11T10:00:00.000Z")).toISOString(),
    "2026-08-12T10:00:00.000Z"
  );
});

test("截止时刻跨月、跨年都算得对（不是「减一个月」这类近似）", () => {
  assert.equal(
    emailProcessedRetentionCutoff(new Date("2026-01-15T00:00:00.000Z")).toISOString(),
    "2025-12-16T00:00:00.000Z"
  );
  assert.equal(
    emailProcessedRetentionCutoff(new Date("2026-03-01T23:30:00.000Z")).toISOString(),
    "2026-01-30T23:30:00.000Z"
  );
});

test("截止时刻只由传入的时间决定，与系统当前时间无关", () => {
  const first = emailProcessedRetentionCutoff(new Date("2026-09-11T10:00:00.000Z"));
  const second = emailProcessedRetentionCutoff(new Date("2026-09-12T10:00:00.000Z"));

  assert.equal(second.getTime() - first.getTime(), 24 * 60 * 60 * 1000);
  assert.ok(first.getTime() < new Date("2026-09-11T10:00:00.000Z").getTime(), "截止时刻在过去");
});

test("保留天数可覆盖（保留 1 天与 30 天相差 29 天）", () => {
  const now = new Date("2026-09-11T10:00:00.000Z");

  assert.equal(emailProcessedRetentionCutoff(now, 1).toISOString(), "2026-09-10T10:00:00.000Z");
  assert.equal(
    emailProcessedRetentionCutoff(now, 1).getTime() - emailProcessedRetentionCutoff(now).getTime(),
    29 * 24 * 60 * 60 * 1000
  );
});

test("清理语句只删去重表、用参数化截止时刻（E.4）", () => {
  const source = readFileSync(STORE, "utf8");
  const cleanups = sqlStatements(source).filter((sql) =>
    /\bDELETE\s+FROM\s+automation_email_processed_messages\b/i.test(sql)
  );

  assert.equal(
    cleanups.length,
    1,
    `期望恰好一条清理去重表的 DELETE，实际 ${cleanups.length} 条 —— 语句被挪走/删掉/写了两份？`
  );
  const sql = cleanups[0];

  // 删除范围只由时间决定：误加 mailbox_id / created_by_user_id 之类的条件会让某些用户的
  // 过期行永远清不掉（表无界增长），而这张表本来就不该按用户维度清理。
  assert.match(sql, /WHERE\s+created_at\s*<\s*\$\d/i);
  assert.doesNotMatch(sql, /mailbox_id|created_by_user_id/i);
  assert.doesNotMatch(sql, /INTERVAL/i, "保留期必须在 JS 里算出来（可测），不要写成 SQL 字面量");
  assert.doesNotMatch(
    sql,
    /automation_email_mailbox_cursors|automation_email_rule_events/,
    "清理只碰去重表：游标被删会让邮件重复处理或漏掉，这是本模块最危险的邻接改动"
  );

  // 截止时刻必须来自 retention.ts，而不是在这个函数里重新减一遍天数。
  assert.match(
    functionBody(source, "cleanupAutomationEmailProcessedMessages"),
    /emailProcessedRetentionCutoff\(/
  );
});

test("清理挂在调度器上，每天跑一次（不另起计时器）", () => {
  const source = readFileSync(SCHEDULER, "utf8");

  assert.match(
    source,
    /cleanupAutomationEmailProcessedMessages/,
    "调度器必须调用 store 的清理函数"
  );

  // 与既有两个扫描任务同一套做法：同一个 node-cron、同样的 global 句柄防重复初始化。
  const scheduled = [
    ...source.matchAll(/cron\.schedule\(\s*"([^"]+)"\s*,\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*\)/g),
  ].map((match) => ({ expression: match[1], body: match[2] }));
  const daily = scheduled.filter((item) => /^\d+ \d+ \* \* \*$/.test(item.expression));

  assert.equal(
    daily.length,
    1,
    `期望恰好一条「每天一次」的 cron，实际 ${daily.length} 条 —— 清理被改成高频或换成了别的计时器？`
  );
  assert.match(daily[0].body, /runAutomationEmailRetentionCleanup\(\)/);
  assert.doesNotMatch(source, /setInterval|setTimeout/, "调度器不另起计时器");
});
