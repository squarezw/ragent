/**
 * 自动化表结构的一致性守卫。
 *
 * 应用进程不执行 DDL。这个改动换来一个静默的失效模式：校验清单与实际查询表名
 * 分属不同模块，谁都不会因为另一方改动而自动报错。
 *
 *   1. `lib/automation/schema.ts`   —— 启动校验用的清单 AUTOMATION_TABLES
 *   2. `lib/` 下各模块里的 FROM/JOIN/INTO/UPDATE —— 代码真正查的表
 *
 * 两者漂移的后果都不是类型错误：
 * - 清单多一张表 → 每次启动都因校验失败，整个自动化瘫痪；
 * - 代码查了清单里没有的表 → 校验永远发现不了它缺失。
 *
 * 另一条守卫是"自动化模块里不得再出现 DDL"：这次改造的全部价值就在于此，
 * 而它同样不会被任何类型检查发现 —— 谁随手写一句 CREATE TABLE IF NOT EXISTS，
 * 应用就又开始在建表了。
 *
 * 手法与其他源码守卫一致：钉源码文本（这些模块依赖
 * `lib/db`，本套件不连数据库、也不 import `@/lib`，没有可执行的断言入口）。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

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

/** lib/automation/schema.ts 里 AUTOMATION_TABLES 声明的表名（启动校验清单）。 */
function tablesDeclaredInModule(): string[] {
  const source = readFileSync(SCHEMA_MODULE, "utf8");
  const array = source.match(/AUTOMATION_TABLES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(array, "lib/automation/schema.ts 里找不到 AUTOMATION_TABLES 数组");

  return [...array[1].matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((match) => match[1]).sort();
}

/** 代码里真正查询过的 automation_* 表名（FROM / JOIN / INTO / UPDATE 后面那个词）。 */
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

  // 清单多表会使自动化无法启用，代码查了清单外的表则无法提前发现缺失。
  assert.deepEqual(
    inCode,
    inModule,
    "代码查询的表与校验清单不一致：清单少表则缺表时静默通过，多表则启动即抛错"
  );
});

test("自动化模块里不再有任何 DDL", () => {
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
    `应用进程不得建表或改表：\n${offenders.join("\n")}`
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
