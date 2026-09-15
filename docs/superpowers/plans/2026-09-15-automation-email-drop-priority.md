# 邮件触发去掉优先级：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉邮件触发的优先级设置，改为「一封邮件命中的每条自动化都执行」，并发执行、失败互不影响。

**Architecture:** 真正保证「只有一条胜出」的是 `automation_email_processed_messages` 上的唯一键
`(created_by_user_id, mailbox_id, message_key)`——它不含 `automation_id`，所以第二条规定连 claim
都过不去。把 `automation_id` 加进唯一键，同时把 `claimAutomationEmailMessage` 的 `ON CONFLICT`
目标改成四列，是本次改动的开关。调度器从「排序选一条」改为「逐条 claim + `Promise.allSettled`
并发执行」，游标仍在全部 settle 之后推进。

**Tech Stack:** Next.js 15 (pages/api) · PostgreSQL (pg) · node:test + `node --experimental-strip-types`

**Spec:** `docs/superpowers/specs/2026-09-15-automation-email-drop-priority-design.md`

## Global Constraints

- **本计划的数据库改动与代码改动必须同批发布。** 唯一键 ALTER 与 `ON CONFLICT` 目标是刚性配对：
  只跑 ALTER 不改代码，PostgreSQL 会以 `there is no unique or exclusion constraint matching the
  ON CONFLICT specification` 拒绝每一次 claim。
- **改 `db/automation.sql` 时，表已存在的场景不能靠改上半部分的 `CREATE TABLE`。**
  所有 CREATE 都带 `IF NOT EXISTS`，在已有该表的库上整条语句静默跳过。结构变更一律以显式
  `ALTER TABLE` 追加到文件末尾（该文件头部已写明这条铁律）。
- **测试套件不连数据库。** `lib/automation/*`、`lib/cron/*` 都依赖 `lib/db`，import 不到，
  因此行为断言一律用「读源码文本」的手法（仓库既有做法，见
  `test/automationSystemMailboxRetired.test.ts`、`test/mailboxHealth.test.ts`）。
- **单文件测试命令：** `node --experimental-strip-types --test test/<name>.test.ts`
  （全量是 `pnpm test`，其中 `test/appsTenantFilter.test.ts` 有一条**基线就失败**的用例，
  与本计划无关，不要试图修它）。
- **改既有文件用 node 脚本做切片时注意工作区是 CRLF**，锚点里不要带 `\n`。
- **测试通过后立即提交**，每个 task 一个 commit。

---

### Task 1: claim 改为「每条自动化各领一次」（DB 唯一键 + 代码，原子）

这是本次改动的开关。唯一键不加 `automation_id`，第二条规定永远无法 claim。

**Files:**
- Modify: `db/automation.sql`
- Modify: `lib/automation/store.ts`（`claimAutomationEmailMessage`）
- Test: `test/automationSchemaFile.test.ts`（追加守卫）

**Interfaces:**
- Produces: `claimAutomationEmailMessage(userId, mailboxId, messageKey, automationId): Promise<boolean>`
  —— 签名不变，语义从「抢占该邮件的唯一所有权」变为「本条自动化是否首次领取这封邮件」。
- Produces: 数据库约束名 `automation_email_processed_once_per_automation`，
  列 `(created_by_user_id, mailbox_id, message_key, automation_id)`。

- [ ] **Step 1: 先写失败的守卫测试**

在 `test/automationSchemaFile.test.ts` 末尾追加（该文件已有 `AUTOMATION_SQL` 常量与
`withoutComments` 助手，直接复用）：

```ts
test("去重表的唯一键包含 automation_id —— 一封邮件可由多条自动化各领一次", () => {
  // 这是「命中即全部执行」的开关。唯一键少了 automation_id，第二条规定连 claim 都过不去，
  // 无论调度器怎么写。改动它必须同时改 claimAutomationEmailMessage 的 ON CONFLICT 目标，
  // 否则 PostgreSQL 会以「no unique or exclusion constraint matching」拒绝每一次 claim。
  const source = withoutComments(readFileSync(AUTOMATION_SQL, "utf8"));
  const table = source.match(
    /CREATE TABLE IF NOT EXISTS automation_email_processed_messages \([\s\S]*?\n\);/
  );
  assert.ok(table, "db/automation.sql 里找不到 automation_email_processed_messages 的建表语句");

  assert.match(
    table[0],
    /CONSTRAINT automation_email_processed_once_per_automation\s+UNIQUE\s*\(\s*created_by_user_id,\s*mailbox_id,\s*message_key,\s*automation_id\s*\)/i,
    "唯一键必须显式命名并包含 automation_id"
  );
});

test("claim 的 ON CONFLICT 目标是四列，与唯一键一致", () => {
  const source = withoutComments(readFileSync(join(process.cwd(), "lib/automation/store.ts"), "utf8"));
  const body = source.slice(source.indexOf("export async function claimAutomationEmailMessage"));

  assert.match(
    body.slice(0, 1200),
    /ON CONFLICT \(created_by_user_id, mailbox_id, message_key, automation_id\)/i,
    "ON CONFLICT 目标必须与唯一键的四列完全一致"
  );
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --experimental-strip-types --test test/automationSchemaFile.test.ts`
Expected: FAIL —— 两条新用例都红（唯一键还是三列，`ON CONFLICT` 也是三列）

- [ ] **Step 3: 改 `db/automation.sql`**

3a. 在 `CREATE TABLE IF NOT EXISTS automation_email_processed_messages (...)` 里，把
`UNIQUE(created_by_user_id, mailbox_id, message_key)` 这一行替换为显式命名的约束
（必须命名：PG 自动生成的截断名无法在 ALTER 里可靠引用）：

```sql
  CONSTRAINT automation_email_processed_once_per_automation
    UNIQUE (created_by_user_id, mailbox_id, message_key, automation_id)
```

3b. 在文件末尾「── 结果 ──」段落**之前**追加迁移段：

```sql
-- ── 迁移：一封邮件从「只允许一条自动化领取」改为「每条各领一次」────────────────
--
-- 唯一键不含 automation_id 时，第二条规定连 claim 都过不去（ON CONFLICT DO NOTHING 直接冲突），
-- 无论调度器怎么写。加列即开关。
--
-- DROP IF EXISTS + 条件 ADD 同时适配两种库：全新库（上面的 CREATE 已建好新约束，两段都是
-- no-op）与已存在的库（旧约束在、新约束不在，正常迁移）。条件 ADD 的写法沿用
-- lib/documentFileVersions.ts 里的既有惯用法 —— PostgreSQL 不支持 ADD CONSTRAINT IF NOT EXISTS。
ALTER TABLE automation_email_processed_messages
  DROP CONSTRAINT IF EXISTS automation_email_processed_me_created_by_user_id_mailbox_id_key;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'automation_email_processed_once_per_automation') THEN
    ALTER TABLE automation_email_processed_messages
      ADD CONSTRAINT automation_email_processed_once_per_automation
      UNIQUE (created_by_user_id, mailbox_id, message_key, automation_id);
  END IF;
END $$;
```

- [ ] **Step 4: 改 `lib/automation/store.ts` 的 `claimAutomationEmailMessage`**

把 `ON CONFLICT (created_by_user_id, mailbox_id, message_key) DO NOTHING` 改为：

```sql
    ON CONFLICT (created_by_user_id, mailbox_id, message_key, automation_id) DO NOTHING
```

并更新该函数的文档注释（当前注释描述的是「抢占唯一所有权」的旧语义），改为说明：
每条自动化各自领取一次，返回 `true` 表示本条首次领取、应当执行。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --experimental-strip-types --test test/automationSchemaFile.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 6: 在一次性库上真跑一遍迁移**

```bash
docker exec -i postgres psql -U postgres -c 'DROP DATABASE IF EXISTS automation_mig_test'
docker exec -i postgres psql -U postgres -c 'CREATE DATABASE automation_mig_test'
# 全新库：应建出 10 张表，唯一键为四列
docker exec -i postgres psql -v ON_ERROR_STOP=1 -U postgres -d automation_mig_test < db/automation.sql
docker exec -i postgres psql -U postgres -d automation_mig_test -c '\d automation_email_processed_messages' | grep -A3 'Indexes'
# 幂等：重复导入只应 WARNING，退出码 0
docker exec -i postgres psql -v ON_ERROR_STOP=1 -U postgres -d automation_mig_test < db/automation.sql
```

Expected: 建表输出以 `自动化表 10 张` 结束；索引区出现
`automation_email_processed_once_per_automation UNIQUE CONSTRAINT, btree (created_by_user_id, mailbox_id, message_key, automation_id)`；
重复导入退出码 0。

- [ ] **Step 7: 在已有旧约束的库上验证迁移路径**

```bash
docker exec -i postgres psql -U postgres -d ragent -c \
  "SELECT conname FROM pg_constraint WHERE conrelid='automation_email_processed_messages'::regclass"
```

Expected: 看到旧名 `automation_email_processed_me_created_by_user_id_mailbox_id_key`。
**本步骤只读，不动 `ragent` 库** —— 本地库的迁移由使用者在确认后自行执行。

- [ ] **Step 8: 提交**

```bash
git add db/automation.sql lib/automation/store.ts test/automationSchemaFile.test.ts
git commit -m "feat(automation): 去重表唯一键加 automation_id，允许多条自动化各领一次"
```

清理一次性库：`docker exec -i postgres psql -U postgres -c 'DROP DATABASE IF EXISTS automation_mig_test'`

---

### Task 2: 调度器改为「命中即全部并发执行」

**Files:**
- Modify: `lib/cron/automation-scheduler.ts`（`processEmailMailboxGroup` 的消息循环）
- Test: 新建 `test/automationEmailParallelRun.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `claimAutomationEmailMessage`（签名不变，语义已变为「每条各领一次」）。
- Produces: `processEmailMailboxGroup` 对每封邮件，命中的每条自动化各自 claim，
  claim 成功的全部交给 `Promise.allSettled` 并发执行，游标在全部 settle 之后推进。

- [ ] **Step 1: 写失败的守卫测试**

新建 `test/automationEmailParallelRun.test.ts`：

```ts
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

test("游标在全部执行 settle 之后推进", () => {
  const fn = body(readFileSync(SCHEDULER, "utf8"), "processEmailMailboxGroup");
  const executed = fn.indexOf("Promise.allSettled(");
  const cursor = fn.indexOf("saveAutomationEmailMailboxCursor(");

  assert.ok(executed >= 0 && cursor >= 0, "两处调用都应当存在");
  assert.ok(
    executed < cursor,
    "游标必须在执行之后推进：提前推进会让崩溃时「邮件已标记处理、实际没跑、且不再重试」"
  );
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --experimental-strip-types --test test/automationEmailParallelRun.test.ts`
Expected: FAIL —— 当前是 `matched[0]` + 单条 `await`，没有 `Promise.allSettled`，也没有 `for (const task of matched)`

- [ ] **Step 3: 改写 `processEmailMailboxGroup` 的消息循环**

把 `lib/cron/automation-scheduler.ts` 中 `for (const message of ordered) { ... }` 循环体内
`if (!subject.startsWith(...))` 那一段（当前约 503–557 行，从 `const messageKey =` 到
`if (winner && claimed) { ... }` 结束）整体替换为：

```ts
      const messageKey = String(message.message_id || "").trim() || `uid:${uid}`;
      const matched = tasks.filter((task) =>
        doesMailRuleSetMatch(mailRuleSetFromTask(task), message)
      );

      // 每条自动化各自 claim（唯一键含 automation_id，互不阻塞）。
      // 一封邮件命中的多条自动化会**全部执行**，不再由优先级选出一条胜出。
      const claimedTasks: any[] = [];
      const claimedIds = new Set<number>();
      for (const task of matched) {
        const taskId = Number(task.id);
        if (await claimAutomationEmailMessage(userId, mailboxId, messageKey, taskId)) {
          claimedIds.add(taskId);
          claimedTasks.push(task);
        }
      }

      const matchedIds = new Set(matched.map((task) => Number(task.id)));
      await recordAutomationEmailRuleEvaluations(
        tasks.map((task) => {
          const taskId = Number(task.id);
          let outcome: "triggered" | "suppressed_by_priority" | "not_matched" | "duplicate";
          if (!matchedIds.has(taskId)) {
            outcome = "not_matched";
          } else {
            outcome = claimedIds.has(taskId) ? "triggered" : "duplicate";
          }

          return {
            userId,
            mailboxId,
            messageKey,
            messageUid: uid,
            automationId: taskId,
            outcome,
            winnerAutomationId: null,
            matchedRule: mailRulesSummary(mailRuleSetFromTask(task)),
            priority: Number(task.trigger_config?.priority ?? 50),
            from: message.from,
            to: message.to,
            subject: message.subject,
            date: message.date,
          };
        })
      );

      // 并发执行，失败互不影响（allSettled 而非 all）；等全部结束再推进游标，
      // 保持与改动前一致的 at-most-once 语义：崩溃时游标落后 → 重新读到这封邮件
      // → claim 已写入 → 判为 duplicate → 不重复执行。
      await Promise.allSettled(
        claimedTasks.map((task) => executeEmailAutomation(task, message))
      );
```

**注意：** 本步骤刻意**保留** `outcome` 里的 `suppressed_by_priority` 类型成员、`winnerAutomationId`、
`priority` 三个字段（此时它们已不再被写入有意义的值）。它们由 Task 3 统一清除。
这样 Task 2 结束时 `recordAutomationEmailRuleEvaluations` 的入参类型仍然成立，测试全绿，
两批改动可以分别 review。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --experimental-strip-types --test test/automationEmailParallelRun.test.ts`
Expected: PASS

- [ ] **Step 5: 跑一遍相关测试，确认没有连带破坏**

Run: `node --experimental-strip-types --test test/automationEmailRetention.test.ts test/mailboxHealth.test.ts test/automationSystemMailboxRetired.test.ts`
Expected: 全绿（`automationEmailRetention` 只断言去重表的清理语句，本不该受影响——若它红了，说明改到了清理逻辑，停下来看清楚）

- [ ] **Step 6: 提交**

```bash
git add lib/cron/automation-scheduler.ts test/automationEmailParallelRun.test.ts
git commit -m "feat(automation): 邮件命中多条自动化时全部并发执行"
```

---

### Task 3: 清除 priority / winner 的全部读写与两列

**Files:**
- Modify: `db/automation.sql`
- Modify: `lib/automation/store.ts`
- Modify: `lib/cron/automation-scheduler.ts`
- Test: `test/automationSchemaFile.test.ts`（追加守卫）

**Interfaces:**
- Produces: `AutomationEmailRuleOutcome` 变为 `"triggered" | "not_matched" | "duplicate"`。
- Produces: `AutomationEmailRuleEvaluationInput` 去掉 `winnerAutomationId`、`priority`。
- Produces: `getAutomationEmailRoutingStats` 返回值去掉 `suppressed`，`recent` 项去掉
  `winnerAutomationId`、`priority`。
- Produces: 自动化 API 输出的邮件触发字段去掉 `mailPriority`。

**部署约束：** 本 Task 的 `DROP COLUMN` 与代码改动必须同批发布。先上代码（不再写这两列）
再 DROP 是安全方向；反过来会让仍在运行的旧代码 INSERT 失败。

- [ ] **Step 1: 写失败的守卫测试**

在 `test/automationSchemaFile.test.ts` 末尾追加：

```ts
test("db/automation.sql 不再声明 priority / winner_automation_id（随优先级一起废弃）", () => {
  const source = withoutComments(readFileSync(AUTOMATION_SQL, "utf8"));
  const table = source.match(/CREATE TABLE IF NOT EXISTS automation_email_rule_events \([\s\S]*?\n\);/);
  assert.ok(table, "db/automation.sql 里找不到 automation_email_rule_events 的建表语句");

  assert.doesNotMatch(table[0], /\bpriority\b/i, "priority 列应已从建表语句移除");
  assert.doesNotMatch(table[0], /\bwinner_automation_id\b/i, "winner_automation_id 列应已移除");
});

test("自动化模块里不再出现优先级 / 胜出者概念", () => {
  const offenders: string[] = [];
  for (const root of ["lib/automation", "lib/cron"]) {
    for (const file of sourceFilesUnder(root)) {
      const source = withoutComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/suppressed_by_priority|winnerAutomationId|normalizeEmailPriority|mailPriority/g)) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `优先级与胜出者概念应已彻底移除：\n${offenders.join("\n")}`
  );
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --experimental-strip-types --test test/automationSchemaFile.test.ts`
Expected: FAIL —— 两条新用例都红

- [ ] **Step 3: 改 `db/automation.sql`**

3a. 从 `CREATE TABLE IF NOT EXISTS automation_email_rule_events (...)` 里删掉这两行：

```sql
  winner_automation_id INTEGER,
  priority INTEGER,
```

3b. 在文件末尾「── 结果 ──」段落**之前**追加：

```sql
-- ── 迁移：优先级与「胜出者」概念废弃（改为一封邮件命中的每条自动化都执行）────────
--
-- 两列都是 DROP IF EXISTS：全新库上面已不声明它们（no-op），旧库在这里被清掉。
ALTER TABLE automation_email_rule_events DROP COLUMN IF EXISTS priority;
ALTER TABLE automation_email_rule_events DROP COLUMN IF EXISTS winner_automation_id;
```

- [ ] **Step 4: 改 `lib/automation/store.ts`**

| 位置 | 改动 |
|---|---|
| `function normalizeEmailPriority(...)` | 整个函数删除 |
| `createAutomation` 的邮件分支 | 删掉 `priority: normalizeEmailPriority(...)` 那一行 |
| `updateAutomation` 的邮件分支 | 删掉 `priority: normalizeEmailPriority(...)` 那一行 |
| `AutomationEmailRuleOutcome` | 去掉 `"suppressed_by_priority"` 成员 |
| `AutomationEmailRuleEvaluationInput` | 删掉 `winnerAutomationId?: number \| null;` 与 `priority?: number;` |
| `recordAutomationEmailRuleEvaluations` 的 INSERT | 列清单去掉 `winner_automation_id, priority`；两处 `params.push(...)` 对应项删掉；`Array.from({ length: 13 }, ...)` 的 13 改为 11 |
| `getAutomationEmailRoutingStats` 统计 SQL | 删掉 `COUNT(*) FILTER (WHERE outcome = 'suppressed_by_priority')::int AS suppressed,` |
| 同函数 recent SQL 与返回体 | 删掉 `winner_automation_id, priority` 两列与 `winnerAutomationId`、`priority` 两个返回字段 |
| 同函数返回对象 | 删掉 `suppressed: Number(row.suppressed \|\| 0),` |
| 邮件触发的 triggerDetail 标签 | `… · 优先级 ${normalizeEmailPriority(config.priority)}` 整段去掉 |
| `automationRowToApi` | 删掉 `mailPriority: normalizeEmailPriority(config.priority),` |

- [ ] **Step 5: 改 `lib/cron/automation-scheduler.ts`**

5a. `executeEmailAutomation` 的 `triggerContext` 里删掉 `priority: Number(config.priority ?? 50),`。

5b. `processEmailMailboxGroup` 里删掉 Task 2 保留的三个残留：
- `outcome` 的联合类型去掉 `"suppressed_by_priority"`
- `winnerAutomationId: null,` 一行删除
- `priority: Number(task.trigger_config?.priority ?? 50),` 一行删除

- [ ] **Step 6: 跑测试确认通过**

Run: `node --experimental-strip-types --test test/automationSchemaFile.test.ts`
Expected: PASS

- [ ] **Step 7: 在一次性库上验证迁移与幂等**

```bash
docker exec -i postgres psql -U postgres -c 'CREATE DATABASE automation_mig_test'
docker exec -i postgres psql -v ON_ERROR_STOP=1 -U postgres -d automation_mig_test < db/automation.sql
docker exec -i postgres psql -U postgres -d automation_mig_test -c '\d automation_email_rule_events' | grep -cE 'priority|winner_automation_id'
```

Expected: 最后一条命令输出 `0`（两列都不存在）；建表以 `自动化表 10 张` 结束。
再重复导入一次确认退出码 0，然后 `DROP DATABASE automation_mig_test`。

- [ ] **Step 8: 确认全仓库已无残留**

```bash
grep -rn -iE 'suppressed_by_priority|winnerAutomationId|normalizeEmailPriority|mailPriority' \
  --include=*.ts --include=*.tsx lib pages app components hooks
```

Expected: **只有 `app/automation/page.tsx` 会命中**（前端由 Task 4 处理）。
`lib/`、`pages/`、`hooks/` 下应无任何命中。

- [ ] **Step 9: 提交**

```bash
git add db/automation.sql lib/automation/store.ts lib/cron/automation-scheduler.ts test/automationSchemaFile.test.ts
git commit -m "refactor(automation): 彻底移除邮件触发的优先级与胜出者概念"
```

---

### Task 4: 前端删除优先级、改写冲突提示与统计文案

前端必须一次改完：删掉 `mailPriority` state 会让所有消费者同时类型错误，
分批改中间态编译不过。

**Files:**
- Modify: `app/automation/page.tsx`

**Interfaces:**
- Consumes: Task 3 之后的 API 形状 —— 邮件触发字段无 `mailPriority`；路由统计无 `suppressed`；
  recent 项无 `priority`、`winnerAutomationId`。

- [ ] **Step 1: 删除数据流（这会让文件暂时编译不过，Step 2–4 一起完成后恢复）**

| 位置 | 改动 |
|---|---|
| 约 108 行 | `TriggerConfigInput` 里删 `mailPriority?: number;` |
| 约 207 行 | 事件类型里删 `priority?: number;` |
| 约 196 行 | `EmailRoutingOutcome` **保留** `"suppressed_by_priority"` 成员，但加注释标明它只可能来自存量行（服务端已不再产生）。**不要删它** —— 删掉会让 Step 3f 的 legacy 分支编译不过 |
| 约 219/229 行 | `EmailRoutingStats` 与 `emptyEmailRoutingStats` 删 `suppressed` |
| 约 539 行 | 删 `const [mailPriority, setMailPriority] = useState(50);` |
| 约 1244 行 | 删 `setMailPriority(50);` |
| 约 1302 行 | 删 `setMailPriority(...)` 一行 |
| 约 1422 行 | 提交 payload 里删 `mailPriority: trigger === "邮件触发" ? mailPriority : undefined,` |

- [ ] **Step 2: 删除展示点**

| 位置 | 改动 |
|---|---|
| 约 3350–3355 行 | 删掉整个「规则优先级」`<Field>`（含 `<input type="number">` 与说明文案） |
| 约 1078、1359 行 | 列表项标签里删掉 ` · ${tt("优先级", "Priority")} ${priority}` 一段 |
| 约 3997–4000 行 | 删掉运行抽屉里的「规则优先级」`<InfoItem>` |
| 约 3850–3854 行 | 删掉事件行里的 `{event.priority != null && (...)}` 整块 |
| 约 3456 行 | **本步不动** —— 该行落在 Step 4 整块替换的范围内，先改会让 Step 4 的锚点失效 |
| 约 3486 行 | 「同时命中的自动化」气泡里删掉 ` · {item.priority}` |

- [ ] **Step 3: 改写冲突提示与统计**

3a. **约 3362–3367 行**，冲突提示正文改为：

```tsx
                              {tt(
                                "这些规则可能同时命中同一封邮件。届时这些自动化都会执行（每条各自运行一次），请确认这是否符合预期。",
                                "These rules may match the same email. All of them will then run — each one separately. Confirm that this is what you want.",
                              )}
```

3b. **约 3393–3408 行**，删掉「当前优先级低于其中部分自动化」与「存在相同优先级」两个条件块
（`mailConflictCandidates.some(({ priority }) => ...)` 两段）。`mailConflictCandidates` 里
`priority` 字段本身也一并从 map 与 sort 中去掉（约 616、620 行），排序改为只按 `level` 再按 `id`。

3c. **约 3369、3380 行**，候选人行里删掉 ` · {tt("优先级", "Priority")} {priority}` 与解构出的
`priority`。

3d. **约 3765–3768 行**，统计说明文案改为：

```tsx
                      {tt(
                        "路由统计记录服务端实际检查结果，包括未命中的邮件与重复投递的邮件。",
                        "Routing statistics cover server-side checks, including unmatched messages and duplicate deliveries.",
                      )}
```

3e. **约 3788–3795 行**，删掉「被高优先级截获」整个统计卡片。

3f. **约 3830–3837 行**，outcome 文案调整为：

```tsx
                          const outcomeText =
                            event.outcome === "triggered"
                              ? tt("已触发", "Triggered")
                              : event.outcome === "duplicate"
                                ? tt("重复拦截", "Deduplicated")
                                : event.outcome === "suppressed_by_priority"
                                  ? tt("未执行（旧版优先级规则）", "Not run (legacy priority rule)")
                                  : tt("未命中", "Not Matched");
```

**这段 legacy 分支是刻意的**：库里已有存量行写着 `suppressed_by_priority`（本地 8 行，
生产无）。删掉映射会让那些老行渲染成空白的「未命中」，比留一行只读映射更糟。
不要删它，也不要为它加新的写入路径。

- [ ] **Step 4: 改写规则测试器**

`mailRuleTestResult`（约 625–672 行）去掉 `winner` 概念：

- `candidates` 的 map 里删掉 `priority` 字段（约 648 行）
- `candidates.sort(...)`（约 661–664 行）整个删除 —— 不再需要排序，命中即全部执行
- 返回对象里**只删掉** `winner: candidates[0] || null,` 这一行。
  `matchedCandidates: candidates,` **本来就已经存在**，保留不动，不要重复添加。

**约 3440–3459 行**的结果卡改为：

```tsx
                                <div className={`rounded-lg border px-3 py-2.5 ${
                                  mailRuleTestResult.currentMatched
                                    ? "border-emerald-200 bg-emerald-50/70"
                                    : "bg-muted/25"
                                }`}>
                                  <div className="text-xs font-semibold">
                                    {mailRuleTestResult.currentMatched
                                      ? tt("结果：当前自动化会触发", "Result: current automation will run")
                                      : tt("结果：当前自动化不会触发", "Result: current automation will not run")}
                                  </div>
                                  {mailRuleTestResult.currentMatched &&
                                    mailRuleTestResult.matchedCandidates.length > 1 && (
                                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                        {tt(
                                          "同一封邮件还会触发以下自动化，它们会与当前自动化各自运行一次。",
                                          "The same email will also trigger the following automations; each will run separately.",
                                        )}
                                      </div>
                                    )}
                                </div>
```

**约 3480–3491 行**的「同时命中的自动化」块：把 `length > 1` 保持不变，
但气泡内容（Step 2 已删掉 ` · {item.priority}`）现在只显示名称。

- [ ] **Step 5: 编译验证**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'app/automation/page.tsx'`
Expected: **无输出**（该文件无类型错误）。注意全仓库有约 179 条基线类型错误，与本改动无关，
所以必须按文件过滤，不能看总数。

Run: `rm -rf .next && pnpm build`
Expected: 退出码 0，`Compiled successfully`。（若报
`Cannot read properties of undefined (reading 'length')`，那是 `.next` 缓存损坏，
`rm -rf .next` 后重试即可——已确认在基线也存在。）

- [ ] **Step 6: 跑全量测试**

Run: `pnpm test`
Expected: `fail 1`，且**唯一**失败项是 `租户列表拉取失败不影响整页`
（`test/appsTenantFilter.test.ts`，基线就失败，与本计划无关）。通过数应 ≥ 691。

- [ ] **Step 7: 提交**

```bash
git add app/automation/page.tsx
git commit -m "feat(automation): 前端移除优先级，改为说明命中即全部执行"
```

---

### Task 5: 端到端验证

**Files:** 无代码改动（纯验证；若发现问题，回到对应 Task 修）

- [ ] **Step 1: 在一次性库上跑完整迁移，确认 final schema 正确**

```bash
docker exec -i postgres psql -U postgres -c 'CREATE DATABASE automation_e2e'
docker exec -i postgres psql -v ON_ERROR_STOP=1 -U postgres -d automation_e2e < db/automation.sql
# 唯一键四列
docker exec -i postgres psql -U postgres -d automation_e2e -c \
  "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='automation_email_processed_messages'::regclass AND contype='u'"
# 两列已不存在
docker exec -i postgres psql -U postgres -d automation_e2e -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='automation_email_rule_events' AND column_name IN ('priority','winner_automation_id')"
# 全部索引仍在
docker exec -i postgres psql -U postgres -d automation_e2e -c '\dt automation_*'
```

Expected: 唯一键是四列；第二个查询返回 0 行；第三个返回 10 张表。

- [ ] **Step 2: 用与 `lib/automation/schema.ts` 完全相同的查询验证启动校验仍通过**

```bash
docker exec -i postgres psql -U postgres -d automation_e2e -c "
SELECT candidate.name FROM unnest(ARRAY[
  'automation_tasks','automation_runs','automation_run_review_history','automation_run_actions',
  'automation_email_processed_messages','automation_email_mailbox_cursors','automation_email_rule_events',
  'automation_notification_preferences','automation_notification_states','automation_mailboxes'
]::text[]) AS candidate(name)
WHERE to_regclass('public.' || candidate.name) IS NULL"
```

Expected: 0 行（否则应用启动会抛 `AUTOMATION_SCHEMA_MISSING`）。

- [ ] **Step 3: 清理**

```bash
docker exec -i postgres psql -U postgres -c 'DROP DATABASE IF EXISTS automation_e2e'
```

- [ ] **Step 4: 汇总**

向使用者报告：改动的文件清单、`pnpm test` 与 `pnpm build` 的实际输出、
**以及「本地 `ragent` 库尚未迁移」这一事实**（本计划全程未写 `ragent`）。
本地库迁移命令：

```bash
docker exec -i postgres psql -v ON_ERROR_STOP=1 -U postgres -d ragent < db/automation.sql
```

---

## 附：本计划不覆盖的事

- **不做「创建时禁止规则重叠」的校验**（见 spec §八）。规则是否真的同时命中取决于邮件内容，
  静态判定只能做启发式提醒。
- **不清理存量 `suppressed_by_priority` 行、不做数据迁移**。前端保留 legacy 只读映射。
- **不引入并发上限或队列**。风险已在 spec §九 记录；上线后观察真实流量，
  若一封邮件命中过多自动化导致并发过高，另开任务处理。
