/**
 * 模块 A（系统邮箱下线）的源码守卫。
 *
 * 为什么读源码文本而不是跑函数：这一段的核心产物是**一条 SQL 语句**与**几处不再存在的兜底**，
 * 都在依赖 `lib/db` 的模块里，测试进程不连数据库（也不 import `@/lib`），没有可执行的断言入口。
 * 而这些恰好是最容易悄悄回退的地方：
 *
 * - 清理语句的 WHERE 一旦放宽（漏掉 `trigger_type = '邮件触发'`、或把等于判断改成 IN/OR），
 *   它就会从"预期影响 0 行"变成误删其他触发类型的自动化。执行结果无从断言，范围可以断言；
 * - 该语句必须留在 `ensureAutomationTables()` 里：那是它唯一会被执行的地方（initPromise 成功时
 *   每个进程只跑一次，失败后每次 store 调用重试整块 SQL），挪到别处就不再执行；
 * - 防循环判断（模块 A.6）是明确的保留项——结果邮件可能从用户自己的邮箱发出，
 *   最容易被下一次"清理系统邮箱代码"顺手删掉；
 * - `||` 兜底一旦有一处冒回来，就是静默落回已下线分支的入口。
 *
 * 与 test/mailboxCursorSql.test.ts 同一手法：钉住那一行的内容，而不是验证执行结果
 * （执行行为已在抛弃库上做过集成验证，但那不可提交、因此没有回归价值）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const STORE = join(process.cwd(), "lib/automation/store.ts");
const SCHEDULER = join(process.cwd(), "lib/cron/automation-scheduler.ts");
const PAGE = join(process.cwd(), "app/automation/page.tsx");
const MAILBOX_ID = join(process.cwd(), "lib/automation/mailbox-id.ts");
const AUTOMATIONS_INDEX = join(process.cwd(), "pages/api/v1/automations/index.ts");
const AUTOMATIONS_ID = join(process.cwd(), "pages/api/v1/automations/[id].ts");

/** 去掉注释：注释里提到旧值/旧格式是允许的（也确实是需要的），可执行代码里不允许。 */
function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
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

/** 从函数体里取出唯一的 `DELETE FROM automation_tasks …;`；被删掉或写了两份都在这里红。 */
function cleanupStatementIn(functionText: string, label: string): string {
  const found = [
    ...withoutComments(functionText).matchAll(/DELETE\s+FROM\s+automation_tasks[\s\S]*?;/gi),
  ];
  assert.equal(
    found.length,
    1,
    `${label} 里应当恰好有一条 DELETE FROM automation_tasks，实际 ${found.length} 条 —— 语句被挪走/删掉/写了两份？`
  );
  return found[0][0];
}

test("A.1 防御性清理在 ensureAutomationTables 里，且只删「邮件触发 + mailboxKey='system'」", () => {
  const cleanup = cleanupStatementIn(
    functionBody(readFileSync(STORE, "utf8"), "ensureAutomationTables"),
    "ensureAutomationTables"
  );

  assert.match(
    cleanup,
    /trigger_type\s*=\s*'邮件触发'/,
    "缺了 trigger_type 限定就会误删其他触发类型的自动化（spec §七 #9 的关键回归点）"
  );
  assert.match(
    cleanup,
    /trigger_config\s*->>\s*'mailboxKey'\s*=\s*'system'/,
    "必须按 mailboxKey 等于 'system' 判定：等于判断不匹配 NULL"
  );
});

test("A.1 清理语句不得用 OR / IN / 其他列放宽范围", () => {
  const cleanup = cleanupStatementIn(
    functionBody(readFileSync(STORE, "utf8"), "ensureAutomationTables"),
    "ensureAutomationTables"
  );

  // 这两条是"预期影响 0 行"的前提：一旦放宽，被保护的就成了其他任务。
  assert.doesNotMatch(cleanup, /\bOR\b/i, "WHERE 里的 OR 会放宽到其他触发行");
  assert.doesNotMatch(cleanup, /\bIN\s*\(/i, "IN 列表会放宽到其他 mailboxKey 取值");
});

test("A.6 防循环判断保留：自己发出的结果邮件不得再次触发", () => {
  const body = functionBody(readFileSync(SCHEDULER, "utf8"), "processEmailMailboxGroup");

  for (const prefix of ["自动化执行结果：", "[AI对话]"]) {
    assert.ok(
      body.includes(`!subject.startsWith("${prefix}")`),
      `防循环的主题前缀判断「${prefix}」被删了：结果邮件可能从用户自己的监听邮箱发出`
    );
  }
});

test("§十一 不再有 system / 系统邮箱 的兜底值", () => {
  for (const file of [STORE, SCHEDULER, PAGE, MAILBOX_ID]) {
    const source = withoutComments(readFileSync(file, "utf8"));
    const match = source.match(/\|\|\s*["'`](?:system|系统邮箱)["'`]/);
    assert.equal(
      match,
      null,
      `${file} 仍有兜底值 ${match?.[0]}：兜底必须改为显式校验（抛错或显示「未配置」）`
    );
  }
});

test("A.4 创建/更新被拒时返回的是专门文案，不是通用校验失败", () => {
  for (const file of [AUTOMATIONS_INDEX, AUTOMATIONS_ID]) {
    const source = readFileSync(file, "utf8");
    const start = source.indexOf("MAILBOX_SYSTEM_RETIRED");
    assert.ok(start >= 0, `${file} 没有处理 MAILBOX_SYSTEM_RETIRED`);
    assert.ok(
      source.slice(start, start + 200).includes("系统邮箱已下线，请配置监听邮箱"),
      `${file} 对 MAILBOX_SYSTEM_RETIRED 没有返回约定文案`
    );
  }
});
