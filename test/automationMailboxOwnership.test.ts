/**
 * 模块 D.2「监听邮箱归属校验」的源码守卫。
 *
 * 归属校验是这条链路上唯一的安全边界：没有它，客户端可以把自动化指向**别人的**监听邮箱，
 * 此后调度器就会用那个邮箱的凭据去读信、并按配置回信。它依赖 `lib/db`，测试进程连不了
 * 数据库（也不 import `@/lib`），因此这里钉住的是"哪几处必须在"这个结构事实——与
 * test/mailboxCursorSql.test.ts、test/automationSystemMailboxRetired.test.ts 同一手法：
 *
 * - `store.ts` 的创建（createAutomation）与更新（updateAutomation）邮件分支各**恰好**
 *   调用一次 `requireOwnedMailbox`：少一处就是一个可以写入他人邮箱 id 的入口；
 * - 取不到邮箱时抛 `MAILBOX_NOT_OWNED`，不是放行、也不是回退到某个默认邮箱；
 * - 归属判断本身仍按 `id + created_by_user_id` 过滤：漏掉用户条件（或把两个占位符的
 *   顺序写反）会让校验退化成"这个 id 存在即可"，看起来仍然在跑，实际等于没有校验。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const STORE = join(process.cwd(), "lib/automation/store.ts");
const MAILBOXES = join(process.cwd(), "lib/automation/mailboxes.ts");

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

/** 只取邮件触发分支：从 `triggerType === "邮件触发"` 到下一个 `} else if (` 为止。 */
function emailBranch(source: string, functionName: string): string {
  const body = functionBody(source, functionName);
  const start = body.indexOf(`triggerType === "邮件触发"`);
  assert.ok(start >= 0, `${functionName} 里找不到邮件触发分支`);

  const branch = body.slice(start);
  const next = branch.search(/[\r\n]\s*\} else if \(/);
  return next >= 0 ? branch.slice(0, next) : branch;
}

test("D.2 创建与更新两条邮件分支都校验邮箱归属", () => {
  const source = readFileSync(STORE, "utf8");

  for (const [label, functionName] of [
    ["创建", "createAutomation"],
    ["更新", "updateAutomation"],
  ] as const) {
    const calls = [...emailBranch(source, functionName).matchAll(/await\s+requireOwnedMailbox\(/g)];
    assert.equal(
      calls.length,
      1,
      `${label}分支（${functionName}）应当恰好调用一次 requireOwnedMailbox，实际 ${calls.length} 次 —— ` +
        "漏掉就等于允许把自动化指向别人的监听邮箱"
    );
  }
});

test("D.2 归属校验失败时抛 MAILBOX_NOT_OWNED，不放行也不回退默认邮箱", () => {
  const body = functionBody(readFileSync(STORE, "utf8"), "requireOwnedMailbox");

  assert.match(
    body,
    /if\s*\(\s*!mailbox\s*\)\s*throw new Error\(MAILBOX_NOT_OWNED\)/,
    "邮箱不存在或不属于该用户时必须抛错（两种情况都按 404 处理，不泄露他人资源的存在性）"
  );
  assert.match(
    body,
    /getAutomationMailboxForUser\(userId,\s*requireMailboxId\(value\)\)/,
    "邮箱 id 必须先经 requireMailboxId 归一化：遗留的字符串键与已下线的「system」都会在这里被拒"
  );
});

test("D.2 归属谓词仍按 id + created_by_user_id 过滤", () => {
  const predicate = functionBody(readFileSync(MAILBOXES, "utf8"), "getAutomationMailboxForUser");

  assert.match(
    predicate,
    /WHERE\s+id\s*=\s*\$1\s+AND\s+created_by_user_id\s*=\s*\$2/i,
    "漏掉 created_by_user_id（或写反 $1/$2）会让归属校验退化成「这个 id 存在即可」"
  );
  assert.match(
    predicate,
    /\[\s*mailboxId\s*,\s*userId\s*\]/,
    "参数顺序必须是 [mailboxId, userId]：$1 是邮箱 id，$2 是当前用户"
  );
});
