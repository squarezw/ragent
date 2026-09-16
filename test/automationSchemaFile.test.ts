/**
 * 自动化表结构的一致性守卫。
 *
 * 表结构已经不在代码里了 —— 它由部署时执行的建表脚本建立，应用进程不再建表。
 * 这个改动换来一个**新的、静默的失效模式**：三份互不相干的东西必须一直说同一件事，
 * 而它们分属三种文件格式，谁都不会因为另一个改了而报错：
 *
 *   1. `docker/db/automation.sql`   —— 部署时真正执行的建表语句（真源，在**后端仓**）
 *   2. `lib/automation/schema.ts`   —— 启动校验用的清单 AUTOMATION_TABLES
 *   3. `lib/` 下各模块里的 FROM/JOIN/INTO/UPDATE —— 代码真正查的表
 *
 * 三者中任意两个漂移的后果都不是类型错误：
 * - 建表脚本少一张表 → 校验清单漏掉它 → 应用照常启动，直到那个功能被点开才 500；
 * - 清单多一张表 → 每次启动都因"表不存在"抛 AUTOMATION_SCHEMA_MISSING，整个自动化瘫痪；
 * - 代码查了清单里没有的表 → 校验永远发现不了它缺失。
 *
 * 另一条守卫是"自动化模块里不得再出现 DDL"：这次改造的全部价值就在于此，
 * 而它同样不会被任何类型检查发现 —— 谁随手写一句 CREATE TABLE IF NOT EXISTS，
 * 应用就又开始在建表了。
 *
 * ## 为什么①（建表脚本）不在本仓
 *
 * 本仓 ragent-public 是**公开仓**，平台的整体表结构由后端仓 ragent-service 统一维护
 * （`docker/db/`，见那边的 README）。建表脚本的真源因此是
 * **`ragent-service/docker/db/automation.sql`**，本仓**有意不保留副本** ——
 * 留副本必然悄悄落后，而读的人会以为它是真的（`docs/assets/quickStart/SOURCE.md`
 * 记着上一次漂移的教训）。
 *
 * 代价是拿不到后端仓检出时，①这一方无法校验。那几条测试于是**跳过并说明原因**，
 * 而不是假装通过 —— 「测试全绿」比「少校验一方」危险得多。
 * 定位与跳过语义统一在 test/automationSqlPath.ts。
 *
 * 手法与 test/automationSystemMailboxRetired.test.ts 一致：钉源码文本（这些模块依赖
 * `lib/db`，本套件不连数据库、也不 import `@/lib`，没有可执行的断言入口）。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readAutomationSql, SKIP_AUTOMATION_SQL } from "./automationSqlPath.ts";

const SCHEMA_MODULE = join(process.cwd(), "lib/automation/schema.ts");

/** 去掉注释：注释里提到表名是允许的（也确实需要），能断言的只有可执行的那一份。 */
function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^[ \t]*--.*$/gm, "");
}

/** 递归收集某个源码目录下的全部 .ts/.tsx（不跟随符号链接，也不会碰到构建产物目录）。 */
function sourceFilesUnder(root: string): string[] {
  const collected: string[] = [];

  for (const entry of readdirSync(join(process.cwd(), root), { withFileTypes: true })) {
    const relative = join(root, entry.name);
    if (entry.isDirectory()) collected.push(...sourceFilesUnder(relative));
    else if (/\.tsx?$/.test(entry.name)) collected.push(join(process.cwd(), relative));
  }

  return collected;
}

/** 读建表脚本并去掉注释。只有声明了 `{ skip: SKIP_AUTOMATION_SQL }` 的测试才会调到它。 */
function readSql(): string {
  return withoutComments(readAutomationSql());
}

/** ① 建表脚本里 CREATE TABLE 声明的表名。 */
function tablesDeclaredInSql(): string[] {
  const source = readSql();
  return [...source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)]
    .map((match) => match[1])
    .sort();
}

/** ② lib/automation/schema.ts 里 AUTOMATION_TABLES 声明的表名（启动校验清单）。 */
function tablesDeclaredInModule(): string[] {
  const source = readFileSync(SCHEMA_MODULE, "utf8");
  const array = source.match(/AUTOMATION_TABLES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(array, "lib/automation/schema.ts 里找不到 AUTOMATION_TABLES 数组");

  return [...array[1].matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((match) => match[1]).sort();
}

/** ③ 代码里真正查询过的 automation_* 表名（FROM / JOIN / INTO / UPDATE 后面那个词）。 */
function tablesUsedInCode(): string[] {
  const found = new Set<string>();

  for (const root of ["lib", "pages", "app"]) {
    for (const file of sourceFilesUnder(root)) {
      const source = withoutComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(
        /\b(?:FROM|JOIN|INTO|UPDATE)\s+(automation_[a-z0-9_]*)/gi
      )) {
        found.add(match[1]);
      }
    }
  }

  return [...found].sort();
}

test("校验清单与代码实际查询的表名一致", () => {
  const inModule = tablesDeclaredInModule();
  const inCode = tablesUsedInCode();

  // 先确认两边都非空：任何一边的解析写错了，下面的相等断言都会退化成"空 == 空"而永远通过。
  assert.ok(inModule.length > 0, "校验清单解析为空 —— 扫描规则写错了");
  assert.ok(inCode.length > 0, "没有扫到任何查询 automation_* 的语句 —— 扫描规则写错了");

  // 这一条**不依赖后端仓**，所以永远会跑：清单多一张表 = 每次启动都抛
  // AUTOMATION_SCHEMA_MISSING（整个自动化瘫痪），代码查了清单外的表 = 校验永远发现不了。
  assert.deepEqual(
    inCode,
    inModule,
    "代码查询的表与校验清单不一致：清单少表则缺表时静默通过，多表则启动即抛错"
  );
});

test("建表脚本声明的表名与校验清单一致", { skip: SKIP_AUTOMATION_SQL }, () => {
  const inSql = tablesDeclaredInSql();
  const inModule = tablesDeclaredInModule();

  assert.ok(inSql.length > 0, "建表脚本里没解析到任何 CREATE TABLE —— 扫描规则写错了");

  assert.deepEqual(
    inModule,
    inSql,
    "校验清单与建表脚本不一致：清单少表则缺表时静默通过，多表则启动即抛错"
  );
});

test("自动化模块里不再有任何 DDL —— 建表只发生在后端仓的建表脚本", () => {
  const roots = ["lib/automation"];
  const extra = [join(process.cwd(), "lib/cron/automation-scheduler.ts")];
  const offenders: string[] = [];

  for (const file of roots.flatMap(sourceFilesUnder).concat(extra)) {
    const source = withoutComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(
      /\b(CREATE\s+TABLE|CREATE\s+INDEX|ALTER\s+TABLE|DROP\s+TABLE)\b/gi
    )) {
      offenders.push(`${file}: ${match[1]}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "应用进程不得再建表/改表（这是本次改造的全部价值），" +
      "DDL 一律放后端仓 ragent-service 的 docker/db/automation.sql：\n" +
      offenders.join("\n")
  );
});

test("建表脚本里的 CREATE 全部带 IF NOT EXISTS —— 重复导入必须是安全的", {
  skip: SKIP_AUTOMATION_SQL,
}, () => {
  // 生产部署时这份脚本可能被重复执行（换机器、补跑、回滚后重来）。少一个 IF NOT EXISTS，
  // 第二次执行就会以 42P07 中止，而 ON_ERROR_STOP=1 会让整份脚本停在中途。
  const source = readSql();
  const withoutGuard = [
    ...source.matchAll(/CREATE\s+(TABLE|INDEX)\s+(?!IF\s+NOT\s+EXISTS)([a-z_][a-z0-9_]*)/gi),
  ].map((match) => `${match[1]} ${match[2]}`);

  assert.deepEqual(
    withoutGuard,
    [],
    `这些 CREATE 缺少 IF NOT EXISTS，重复导入会失败：\n${withoutGuard.join("\n")}`
  );
});

test("去重表的唯一键包含 automation_id —— 一封邮件可由多条自动化各领一次", {
  skip: SKIP_AUTOMATION_SQL,
}, () => {
  // 这是「命中即全部执行」的开关。唯一键少了 automation_id，第二条规定连 claim 都过不去，
  // 无论调度器怎么写。改动它必须同时改 claimAutomationEmailMessage 的 ON CONFLICT 目标，
  // 否则 PostgreSQL 会以「no unique or exclusion constraint matching」拒绝每一次 claim。
  const source = readSql();
  const table = source.match(
    /CREATE TABLE IF NOT EXISTS automation_email_processed_messages \([\s\S]*?\n\);/
  );
  assert.ok(table, "建表脚本里找不到 automation_email_processed_messages 的建表语句");

  assert.match(
    table[0],
    /CONSTRAINT automation_email_processed_once_per_automation\s+UNIQUE\s*\(\s*created_by_user_id,\s*mailbox_id,\s*message_key,\s*automation_id\s*\)/i,
    "唯一键必须显式命名并包含 automation_id"
  );
});

test("claim 的 ON CONFLICT 目标是四列，与唯一键一致", () => {
  const source = withoutComments(
    readFileSync(join(process.cwd(), "lib/automation/store.ts"), "utf8")
  );
  const body = source.slice(source.indexOf("export async function claimAutomationEmailMessage"));

  assert.match(
    body.slice(0, 1200),
    /ON CONFLICT \(created_by_user_id, mailbox_id, message_key, automation_id\)/i,
    "ON CONFLICT 目标必须与唯一键的四列完全一致"
  );
});

test("建表脚本不再声明 priority / winner_automation_id（随优先级一起废弃）", {
  skip: SKIP_AUTOMATION_SQL,
}, () => {
  const source = readSql();
  const table = source.match(
    /CREATE TABLE IF NOT EXISTS automation_email_rule_events \([\s\S]*?\n\);/
  );
  assert.ok(table, "建表脚本里找不到 automation_email_rule_events 的建表语句");

  assert.doesNotMatch(table[0], /\bpriority\b/i, "priority 列应已从建表语句移除");
  assert.doesNotMatch(table[0], /\bwinner_automation_id\b/i, "winner_automation_id 列应已移除");
});

test("自动化模块里不再出现优先级 / 胜出者概念", () => {
  const offenders: string[] = [];
  for (const root of ["lib/automation", "lib/cron"]) {
    for (const file of sourceFilesUnder(root)) {
      const source = withoutComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(
        /suppressed_by_priority|winnerAutomationId|normalizeEmailPriority|mailPriority/g
      )) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `优先级与胜出者概念应已彻底移除：\n${offenders.join("\n")}`);
});
