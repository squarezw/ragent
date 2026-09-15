# 邮件触发：去掉优先级，改为命中即全部执行

日期：2026-09-15
状态：待评审

## 一、背景

邮件触发自动化允许用户给同一个监听邮箱创建多个自动化任务。当前每条任务带一个
`priority`（0–100，默认 50），当**同一封邮件同时命中多条任务**时，只有优先级最高的那条
执行，其余记为 `suppressed_by_priority`。

用户提出去掉优先级。理由：**规则集本身就是业务边界的表达**。「发票」任务和「报表」任务
各有一套规则，正常情况下不会同时命中。优先级只在规则重叠时才有意义，而重叠要么是配置
失误，要么是这封邮件**真的同时属于两摊业务**——两种情况下压掉其中一条都不是用户想要的。

因此本次改动把语义从「竞争」改成「广播」：**一封邮件命中的每一条自动化都执行。**

## 二、现状：保证「只有一条胜出」的其实是数据库约束

这一点决定了改动的规模。优先级只是决定「谁去抢」，真正让第二条任务过不去的是
`automation_email_processed_messages` 上的唯一键：

```sql
UNIQUE (created_by_user_id, mailbox_id, message_key)
```

以及 `claimAutomationEmailMessage` 里对应的：

```sql
ON CONFLICT (created_by_user_id, mailbox_id, message_key) DO NOTHING
```

**唯一键不含 `automation_id`，所以第二条规定连「领取」这一步都无法完成。** 改语义必须先改这个约束，
它不是可选的清理项，而是这次改动的开关。

## 三、设计决策

### D1：命中即全部执行，无胜出者

`matched` 集合中的每一条任务各自 claim、各自执行。不存在「赢家」概念，
`winner_automation_id` 随之失去意义（见 D5）。

### D2：并发执行，但等全部结束再推进游标

用 `Promise.allSettled` 并发执行本次命中的全部任务，全部 settle 之后再推进游标。

三个候选方案的取舍：

| 方案 | 失败隔离 | 崩溃安全性 | 说明 |
|---|---|---|---|
| 依次 `await` | ❌ 一条抛错中断循环，后面的任务不执行 | ✅ | **直接违背需求** |
| `Promise.allSettled`（选定） | ✅ 各自独立 | ✅ 游标语义与现状一致 | |
| fire-and-forget 并发 | ✅ | ❌ 邮件已标记处理、实际未执行、且不再重试 | 静默丢数据，排除 |

「等全部结束再推进游标」保持了与现状相同的 at-most-once 语义：进程崩溃时游标落后，
下一轮扫描重新读到这封邮件，但 claim 已写入 → 返回 `duplicate` → 不重复执行。
这个窗口在改动前后完全一致，没有引入新的丢失面。

### D3：失败隔离靠 `allSettled`，不靠调用方的 try/catch

`executeEmailAutomation` 内部不新增 try/catch。`allSettled` 天然保证一条失败不影响其他条，
失败原因由既有的按分组错误记录路径处理。

### D4：`suppressed_by_priority` 保留 legacy 映射

该 outcome 取值不再产生，但库里已有存量行（本地 8 行）。前端保留一个只读映射，
显示为「未执行（旧版优先级规则）」。**不删存量行、不做数据迁移**——生产库无这些数据，
本地是测试数据，但让老行渲染成空白比留一行映射更糟。

### D5：`winner_automation_id` 与 `priority` 两列一并删除

`winner_automation_id` 随「胜出者」概念一起失去意义。留着会永远存 NULL，是让人困惑的死字段。
`priority` 同理。两列都用 `DROP COLUMN IF EXISTS` 迁移。

## 四、数据模型变更

全部追加到 `db/automation.sql`（**不能改文件上半部分的 `CREATE TABLE`** —— 已存在的表上
`IF NOT EXISTS` 会让整条语句静默跳过，这是该文件头部写明的铁律）。

### 4.1 `automation_email_processed_messages`：唯一键加 `automation_id`

`CREATE TABLE` 里把约束**显式命名**（否则 PG 自动生成的截断名难以引用）：

```sql
CONSTRAINT automation_email_processed_once_per_automation
  UNIQUE (created_by_user_id, mailbox_id, message_key, automation_id)
```

迁移段落：

```sql
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

`DROP ... IF EXISTS` + 条件 `ADD` 的组合同时适配两种库：全新库（CREATE 已建好新约束，
两段都是 no-op）与已存在的库（旧约束在、新约束不在，正常迁移）。这个 DO 块写法沿用
`lib/documentFileVersions.ts` 里已有的惯用法。

### 4.2 `automation_email_rule_events`：删除两列

```sql
ALTER TABLE automation_email_rule_events DROP COLUMN IF EXISTS priority;
ALTER TABLE automation_email_rule_events DROP COLUMN IF EXISTS winner_automation_id;
```

同时从文件的 `CREATE TABLE` 里删掉这两列声明。

### 4.3 不受影响

- `automation_email_rule_events` 的唯一键已是四列，无需改动
- `recordAutomationEmailRuleEvaluations` 的 `ON CONFLICT` 已是四列，无需改动
- 去重表的 30 天保留期清理不变（行数会随「每消息 × 每自动化」增长，属预期）

## 五、服务端变更

### `lib/automation/store.ts`

| 位置 | 变更 |
|---|---|
| `normalizeEmailPriority` | 删除 |
| `createAutomation` / `updateAutomation` | 不再读写 `priority` |
| `claimAutomationEmailMessage` | `ON CONFLICT` 目标由三列改为四列（含 `automation_id`）；函数语义从「抢占唯一所有权」改为「本条自动化领取一次」 |
| `AutomationEmailRuleOutcome` | 去掉 `suppressed_by_priority` |
| `AutomationEmailRuleEvaluationInput` | 去掉 `winnerAutomationId`、`priority` |
| `recordAutomationEmailRuleEvaluations` | INSERT 列与参数减少两列 |
| `getAutomationEmailRoutingStats` | 统计 SQL 去掉 `suppressed`；recent SQL 与返回体去掉两字段 |
| 列表标签（`优先级 ${...}`） | 去掉 |
| 邮件触发的 API 输出 `mailPriority` | 去掉 |

### `lib/cron/automation-scheduler.ts`

- `executeEmailAutomation` 的 `triggerContext` 去掉 `priority`
- `processEmailMailboxGroup` 的消息循环：

```ts
const matched = tasks.filter((task) => doesMailRuleSetMatch(mailRuleSetFromTask(task), message));

// 每条各自 claim：同一封邮件命中的多条自动化互不阻塞
const claimed: any[] = [];
for (const task of matched) {
  if (await claimAutomationEmailMessage(userId, mailboxId, messageKey, Number(task.id))) {
    claimed.push(task);
  }
}

// outcome 判定：命中且领到 → triggered；命中但已领过 → duplicate；未命中 → not_matched
// （不再有 suppressed）

await recordAutomationEmailRuleEvaluations(/* 每条 task 一条记录 */);

// 并发执行，等全部结束再推进游标
await Promise.allSettled(claimed.map((task) => executeEmailAutomation(task, message)));

await saveAutomationEmailMailboxCursor(userId, mailboxId, uid, true);
```

`scanEmailAutomations` 的 `automationEmailCronBusy` 防重入不变。

### `pages/api/v1/automation-email/stats.ts`

**无需改动。** 已核对：该路由只做鉴权 + 存在性检查，然后 `res.status(200).json(stats)`
原样透传 `getAutomationEmailRoutingStats` 的返回值，自身不构造字段。

## 六、前端变更（`app/automation/page.tsx`，42 处）

**删除**
- `mailPriority` state、类型字段、`mailPriority: 50` 默认值、提交 payload
- 「规则优先级」输入框（含说明文案）
- 列表项标签、运行抽屉里的 `triggerContext.priority` 显示
- 事件列表里的 `priority` 显示
- 统计里的 `suppressed` 卡片

**改写**
- **冲突提示**：不再比较优先级。保留「可能同时命中」的提醒，文案改为说明**届时都会执行**。
  这个提示因此变得更加必要——两条都会跑，用户更该确认这是否符合预期。
- **规则测试器**：`winner` 概念去掉，改为展示「命中的全部自动化」列表。
- **路由统计文案**：`被高优先级截获` 删除；`suppressed_by_priority` 的 legacy 映射改为
  「未执行（旧版优先级规则）」。

## 七、测试

本套件不连数据库（`lib/cron`、`lib/automation` 都依赖 `lib/db`），因此沿用仓库既有做法——
钉源码文本。「两条都执行」这个行为落点全部是可断言的代码形状：

**新增**
- **调度器守卫**（`lib/cron/automation-scheduler.ts`）：
  - `claimAutomationEmailMessage` 必须在遍历 `matched` 的循环体内被逐条调用，而不是只对
    `matched[0]` 调用一次 —— 这正是「都执行」的实现落点，也是本次改动最容易回退的地方
  - 执行阶段必须用 `Promise.allSettled` 覆盖全部已 claim 的任务
  - 游标推进（`saveAutomationEmailMailboxCursor`）必须出现在执行调用之后
  - 全文不得再出现 `priority` 或 `suppressed_by_priority`
- **`db/automation.sql` 守卫**（归入 `test/automationSchemaFile.test.ts`）：
  - 去重表的唯一键必须包含 `automation_id` —— 这是本次改动的开关，加了它才真正允许多条领取
  - 不得再声明 `priority` / `winner_automation_id` 两列

**复核**
- `test/automationEmailRetention.test.ts`：只断言清理语句，预计不受影响，跑一遍确认

## 八、明确不做

- 不做「创建时禁止规则重叠」的校验。规则是否真的会同时命中取决于邮件内容，
  静态判定只能做启发式提醒，做不到可靠拒绝。
- 不删除存量的 `suppressed_by_priority` 行，不做数据迁移。
- 不引入并发上限或队列。若后续出现「一封邮件命中过多自动化导致并发过高」的实际问题，再单独处理。

## 九、风险

**并发放大了对后端的压力。** 一封邮件命中 N 条自动化 = 并发 N 次 LLM 调用。当前节点的
`automationEmailCronBusy` 保证同时只有一轮扫描，但**一轮扫描内**的邮件会循环处理、
每封邮件的 N 条又并发执行。若某邮箱积压了大量历史邮件且规则重叠严重，可能出现瞬时高并发。
当前不做限制（见第八节），但实施后应观察一次真实流量下的表现。
