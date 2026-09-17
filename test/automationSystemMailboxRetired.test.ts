/**
 * 模块 A（系统邮箱下线）的源码守卫。
 *
 * 为什么读源码文本而不是跑函数：这些代码依赖 `lib/db`，测试进程不连数据库
 * （也不 import `@/lib`），没有可执行的断言入口。
 * 而这些恰好是最容易悄悄回退的地方：
 *
 * - 防循环判断（模块 A.6）是明确的保留项——结果邮件可能从用户自己的邮箱发出，
 *   最容易被下一次"清理系统邮箱代码"顺手删掉；
 * - `||` / `??` 兜底一旦有一处冒回来，就是静默落回已下线分支的入口。这一条按**目录**扫描
 *   `lib/`、`app/`、`pages/` 的全部源码，而不是一份手写文件清单：清单漏掉的那个文件，
 *   正是下一次兜底会冒出来的地方。
 *
 * 与 test/mailboxCursorSql.test.ts 同一手法：钉住那一行的内容，而不是验证执行结果
 * （执行行为已在抛弃库上做过集成验证，但那不可提交、因此没有回归价值）。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SCHEDULER = join(process.cwd(), "lib/cron/automation-scheduler.ts");
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

test("A.6 防循环判断保留：自己发出的结果邮件不得再次触发", () => {
  const body = functionBody(readFileSync(SCHEDULER, "utf8"), "processEmailMailboxGroup");

  for (const prefix of ["自动化执行结果：", "[AI对话]"]) {
    assert.ok(
      body.includes(`!subject.startsWith("${prefix}")`),
      `防循环的主题前缀判断「${prefix}」被删了：结果邮件可能从用户自己的监听邮箱发出`
    );
  }
});

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

test("§十一 不再有 system / 系统邮箱 的兜底值（|| 与 ?? 皆算，全仓库扫描）", () => {
  // 这一条是验收标准里"不再存在任何 system 分支"的自动兜底，因此它必须覆盖**全部**业务源码，
  // 而不是一份手写文件清单——清单漏掉的那个文件，正是下一次兜底冒出来的地方。`??` 与 `||`
  // 同样致命：`config.mailboxLabel ?? "系统邮箱"` 就是一个静默落回已下线分支的入口。
  const offenders: string[] = [];

  for (const root of ["lib", "app", "pages"]) {
    const files = sourceFilesUnder(root);
    assert.ok(
      files.length > 0,
      `没有扫到 ${root}/ 下的任何源文件：扫描范围写错了，这条守卫会变成空转`
    );

    for (const file of files) {
      const source = withoutComments(readFileSync(file, "utf8"));
      const match = source.match(/(?:\|\||\?\?)\s*["'`](?:system|系统邮箱)["'`]/);
      if (match) offenders.push(`${file}: ${match[0]}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `这些地方仍有兜底值：\n${offenders.join("\n")}\n兜底必须改为显式校验（抛错或显示「未配置」）`
  );
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
