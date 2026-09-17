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
 * - 少写 `created_by_user_id` 的范围限定，删除/重置会波及他人同 id 的游标行（游标串号）；
 * - 只给编辑（PUT）路径接上重置、漏掉创建（POST 的 upsert）路径：后者同样按 email 就地
 *   改写主机/账号/文件夹，漏掉的后果是旧高水位留在新服务器上，新邮件被静默丢弃。
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

/**
 * 创建路径（POST）也走 D.4。
 *
 * 创建接口按 `(created_by_user_id, email)` 做 upsert，因此"重填一个已登记的地址、却换了
 * 主机/账号/文件夹"走的就是这条路径。它的失败是静默的：旧高水位留在新服务器上，所有
 * `uid <= 旧值` 的邮件被丢弃，而状态仍显示「已连接」——没有任何可观测的报错入口，只能靠
 * 这组断言钉住。
 */
test("D.4 创建路径：既有行在 upsert 之前取出，身份变了才在写入之后重置游标", () => {
  const create = functionBody(source, "createAutomationMailbox");

  const insertAt = create.search(/INSERT INTO automation_mailboxes/);
  assert.ok(insertAt >= 0, "创建路径应当仍是一条 INSERT ... ON CONFLICT 的 upsert");
  assert.match(
    create.slice(insertAt),
    /ON CONFLICT\s*\(\s*created_by_user_id\s*,\s*email\s*\)/i,
    "upsert 的冲突目标变了：既有行是按 (created_by_user_id, email) 查的，必须与之一致"
  );

  // 先查既有行：upsert 之后旧身份已被覆盖，此时的比较恒为 false，游标就永远不会被重置。
  const lookupAt = create.indexOf("findAutomationMailboxByEmail(");
  assert.ok(
    lookupAt >= 0 && lookupAt < insertAt,
    "既有行必须在 upsert **之前**取出：写入之后旧主机/账号/文件夹已经查不回来了"
  );

  // 判定必须来自单源 helper，不能在这里内联一份比较（否则它与 PUT 路径必然漂移）。
  assert.match(
    create,
    /createMailboxCursorResetRequired\(/,
    "创建路径的游标重置判定应当复用 mailbox-input.ts 的 helper（与 PUT 路径同源）"
  );

  const reset = /if\s*\(\s*cursorResetRequired\s*\)\s*\{\s*await\s+resetAutomationMailboxCursor\(/.exec(
    create
  );
  assert.ok(
    reset,
    "创建路径缺少 `if (cursorResetRequired) { await resetAutomationMailboxCursor(...) }`：" +
      "身份变了却不重置，调度器会拿旧基线比新邮箱的 UID，静默漏掉全部新邮件"
  );
  assert.ok(
    (reset?.index ?? -1) > insertAt,
    "重置必须在 upsert **成功之后**：写失败时既有基线必须原样保留"
  );
  assert.match(
    create.slice(reset?.index ?? 0, (reset?.index ?? 0) + 120),
    /resetAutomationMailboxCursor\(\s*userId\s*,/,
    "重置要按邮箱归属用户限定范围（游标主键含 created_by_user_id，否则会波及他人同 id 的游标行）"
  );
});
