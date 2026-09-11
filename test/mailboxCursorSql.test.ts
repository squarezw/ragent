/**
 * 监听邮箱的游标 SQL 守卫（模块 D.4 游标重置 / D.5 游标清理）。
 *
 * 为什么读源码文本而不是跑函数：`lib/automation/mailboxes.ts` 依赖 `lib/db`，测试进程不连
 * 数据库（也不 import `@/lib`），这两条语句没有可执行的断言入口。而它们恰好是本任务最容易
 * 写错的地方：
 * - Task 1 把游标表的键列从字符串 `mailbox_key` 改成了整数 `mailbox_id`。写成旧列名不会产生
 *   任何类型错误，只在运行时 500；
 * - 少写 `last_uid=0` 更隐蔽：游标"看起来"重置了（initialized=false 确实写进去了），但
 *   `saveAutomationEmailMailboxCursor` 用 `GREATEST(旧值, 新值)` 写回，重建基线时会把旧基线
 *   写回去，此后 `uid > last_uid` 恒不成立，新邮件全部被过滤；
 * - 少写 `created_by_user_id` 的范围限定，删除/重置会波及他人同 id 的游标行（游标串号）。
 *
 * 与 test/skillsProxyQuery.test.ts 同一手法：钉住那一行的内容，而不是验证 SQL 的执行结果
 * （执行行为已在抛弃库上做过集成验证，但那不可提交、因此没有回归价值）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const MAILBOXES = join(process.cwd(), "lib/automation/mailboxes.ts");
const MAILBOX_INPUT = join(process.cwd(), "lib/automation/mailbox-input.ts");

/** 去掉注释：注释里提到旧列名是允许的（也确实是需要的），可执行 SQL 里不允许。 */
function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** 源码里所有「像 SQL」的反引号模板串。 */
function sqlStatements(source: string): string[] {
  return [...withoutComments(source).matchAll(/`([^`]*)`/g)]
    .map((match) => match[1])
    .filter((text) => /\b(SELECT|UPDATE|DELETE|INSERT|CREATE)\b/i.test(text));
}

/** 取游标表上唯一的某条语句；语句被删掉或多出一条都会在这里红。 */
function cursorStatement(source: string, verb: RegExp): string {
  const found = sqlStatements(source).filter((sql) => verb.test(sql));
  assert.equal(
    found.length,
    1,
    `期望游标表上恰好有一条 ${verb} 语句，实际 ${found.length} 条 —— 语句被挪走/删掉/写了两份？`
  );
  return found[0];
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

const source = readFileSync(MAILBOXES, "utf8");
const resetSql = cursorStatement(source, /UPDATE\s+automation_email_mailbox_cursors/i);
const cleanupSql = cursorStatement(source, /DELETE\s+FROM\s+automation_email_mailbox_cursors/i);

test("两条游标语句都用整数 mailbox_id，不用 Task 1 之前的字符串列 mailbox_key", () => {
  assert.match(resetSql, /mailbox_id/);
  assert.match(cleanupSql, /mailbox_id/);
});

test("可执行 SQL 里不出现旧列名 mailbox_key（注释里可以提）", () => {
  const offenders = sqlStatements(source).filter((sql) => sql.includes("mailbox_key"));
  assert.deepEqual(
    offenders,
    [],
    `这些 SQL 还在用旧列名 mailbox_key：\n${offenders.join("\n---\n")}`
  );
});

test("D.4 重置同时归零 last_uid 并把 initialized 置为 FALSE", () => {
  assert.match(
    resetSql,
    /last_uid\s*=\s*0/,
    "D.4 必须把 last_uid 一起归零：saveAutomationEmailMailboxCursor 用 GREATEST 写回，" +
      "只置 initialized=false 会在重建基线时恢复旧的高水位，此后所有新邮件都被过滤掉。"
  );
  assert.match(resetSql, /initialized\s*=\s*FALSE/i);
});

test("D.4 与 D.5 都按 created_by_user_id + mailbox_id 限定范围", () => {
  for (const [label, sql] of [
    ["D.4 重置", resetSql],
    ["D.5 清理", cleanupSql],
  ]) {
    assert.match(
      sql,
      /created_by_user_id\s*=\s*\$\d/,
      `${label} 缺少 created_by_user_id 范围限定（游标串号）`
    );
    assert.match(sql, /mailbox_id\s*=\s*\$\d/, `${label} 缺少 mailbox_id 范围限定`);
  }
});

test("D.4 的触发条件只看主机/账号/文件夹，密码与名称不参与比较", () => {
  const identity = functionBody(readFileSync(MAILBOX_INPUT, "utf8"), "mailboxIdentityChanged");

  for (const field of ["imapHost", "username", "folder"]) {
    assert.match(identity, new RegExp(field), `身份比较里应当有 ${field}`);
  }
  assert.doesNotMatch(
    identity,
    /password/,
    "密码不移动 UID 基线：把它写进身份比较会让一次改密码无谓地丢弃一个轮询窗口的邮件。"
  );
  assert.doesNotMatch(identity, /\bname\b/, "名称只是展示名，同样不参与身份比较。");
});

test("D.4 只在身份变化时重置，D.5 只在删除成功后清理", () => {
  assert.match(
    source,
    /if\s*\(\s*cursorResetRequired\s*\)\s*await\s+resetAutomationMailboxCursor\(/,
    "重置必须以 resolveMailboxUpdate 的 cursorResetRequired 为条件"
  );
  assert.match(
    source,
    /if\s*\(\s*deleted\s*\)\s*await\s+deleteAutomationMailboxCursor\(/,
    "D.5 只能在删除真的发生（deleted）后清理：依赖检查返回 409 时邮箱还在，游标必须保留"
  );
});
