/**
 * 「一封邮件命中的每条自动化都执行」的源码守卫。
 *
 * 为什么读源码而不是跑行为：`lib/cron/automation-scheduler.ts` 依赖 `lib/db`，本套件不连数据库、
 * 也不 import `@/lib`，没有可执行的断言入口（仓库既有做法，见
 * test/automationSystemMailboxRetired.test.ts）。
 *
 * 这里盯的是本次改动最容易回退的两处：
 * 1. claim 必须**逐条**发生。回到「只对 matched[0] 调用一次」，功能就静默退回单条执行，
 *    而且不会产生任何类型错误或报错；
 * 2. 游标必须仍在执行之后推进。提前推进会让「崩溃时邮件未执行但不重试」的窗口出现。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SCHEDULER = join(process.cwd(), "lib/cron/automation-scheduler.ts");

function body(source: string, name: string): string {
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

test("每封邮件对命中的每条自动化逐条 claim，而不是只 claim 第一条", () => {
  const fn = body(readFileSync(SCHEDULER, "utf8"), "processEmailMailboxGroup");

  assert.match(fn, /for \(const task of matched\)/, "必须遍历 matched 逐条 claim");
  assert.match(
    fn,
    /for \(const task of matched\)\s*\{[\s\S]{0,300}?claimAutomationEmailMessage\(/,
    "claimAutomationEmailMessage 必须在遍历 matched 的循环体内"
  );
  assert.doesNotMatch(fn, /matched\[0\]/, "不得再出现「只取第一条」的写法");
});

test("全部 claim 成功的任务交给 Promise.allSettled 并发执行", () => {
  const fn = body(readFileSync(SCHEDULER, "utf8"), "processEmailMailboxGroup");

  assert.match(fn, /Promise\.allSettled\(/, "并发执行必须用 Promise.allSettled（失败互不影响）");
  assert.match(
    fn,
    /Promise\.allSettled\([\s\S]{0,300}?executeEmailAutomation\(/,
    "allSettled 的每一项都应当是 executeEmailAutomation"
  );
});

test("settle 结果必须被检视：执行失败落日志，而不是被 allSettled 无声吞掉", () => {
  const fn = body(readFileSync(SCHEDULER, "utf8"), "processEmailMailboxGroup");

  assert.match(
    fn,
    /(?:const|let)\s+\w+\s*=\s*await Promise\.allSettled\(/,
    "allSettled 的返回值必须被接收；裸 await 会让 rejection 完全静默"
  );
  assert.match(
    fn,
    /"rejected"/,
    "必须显式处理 rejected 分支：executeEmailAutomation 的 requireMailboxLabel / " +
      "prepareEmailAttachments / createRun 都在其内部 try 之外，抛出时会变成零日志"
  );

  const executed = fn.indexOf("Promise.allSettled(");
  const tail = fn.slice(executed);
  assert.match(tail, /console\.error\(/, "rejected 分支必须用 console.error 落日志");
  assert.match(
    tail,
    /\[Automation Email\][\s\S]{0,300}?\.id/,
    "日志要能定位到是哪条自动化失败（至少带 automation id），且沿用 [Automation Email] 前缀"
  );
});

test("游标在全部执行 settle 之后推进", () => {
  const fn = body(readFileSync(SCHEDULER, "utf8"), "processEmailMailboxGroup");
  const executed = fn.indexOf("Promise.allSettled(");
  assert.ok(executed >= 0, "找不到 Promise.allSettled(");

  // 必须从 executed 之后再找游标写入：本函数开头建立基线时（`if (!cursor.initialized)`
  // 那个早退分支）也会调一次 saveAutomationEmailMailboxCursor，用 indexOf 会取到那一次，
  // 位置在执行之前 —— 正确的代码也会被判红。
  const cursor = fn.indexOf("saveAutomationEmailMailboxCursor(", executed);

  assert.ok(
    cursor >= 0,
    "执行之后必须仍有游标推进：提前推进会让崩溃时「邮件已标记处理、实际没跑、且不再重试」"
  );
});
