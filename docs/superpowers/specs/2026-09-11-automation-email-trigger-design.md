# 邮件触发功能完善与平台集成 设计方案

日期：2026-09-11
状态：待评审

## 一、目标

邮件触发的执行链路（服务端调度器每 10 秒轮询邮箱 → 规则匹配 → 优先级竞争 → 去重 → 调用数字员工 → 策略分叉）**已经跑通**，但存在两类问题：

1. **能力已在后端、用户够不着**：自定义监听邮箱的后端（加密存储、真实 IMAP 连接验证、依赖检查删除）已完整实现，但前端完全没有入口，自动化向导写死"系统邮箱"，用户无法配置自己的监听邮箱。
2. **已知缺陷**：服务端零校验、前端冲突检测未按邮箱隔离、连接失败无告警、匹配逻辑双份维护、存在死代码。

本方案让用户在**创建自动化时直接配置监听邮箱**，并**下线"系统邮箱"这一共享概念**（已确认决策），同时修复上述缺陷。

**关键收益**：系统邮箱退场后，平台不再**内建**任何共享监听邮箱，分组键 `${userId}:${mailboxId}` 不再有来自内建共享的跨用户碰撞，且**不再需要 ragent-service 配合开发**（原方案的最大外部依赖）。同时，由于功能从未使用、三张邮件表为空，可以趁此窗口把 `mailbox:<id>` 字符串键统一为整数 `mailboxId`，拆掉为"system"服务的编码脚手架。

> **边界说明**：退场消除的是"内建共享"这一**实例**。系统层面，同一物理邮箱若被注册成多条记录，仍会成为多条互不知情的管道（重复处理、优先级失效）。平台不阻止这种注册；正常用法下不会发生（见第九节「行为说明」）。

## 二、范围

**纳入**：
- 向导 step 2 内联配置监听邮箱（主路径）
- 自动化页轻量邮箱管理入口（改密码 / 删除 / 看状态）
- **系统邮箱下线**（该功能从未被实际使用，无存量迁移负担）
- 服务端校验、冲突检测隔离、连接失败告警、规则逻辑去重、死代码清理

**不纳入（YAGNI）**：
- 系统设置页的 IMAP 收信配置（随系统邮箱退场一并取消）
- **SMTP 发信配置保持不动**：系统设置里的 `smtp_config` 用于发送结果通知邮件（`/api/v1/email/send`），与 IMAP 收信无关，本次不改
- 附件内容解析后传给 AI（现状只传附件名）
- 部门/角色级邮箱共享（已确认：仅创建者本人）
- 调度器多实例分布式锁（DB 唯一约束已防重复触发）
- 自动化页存量 `tt()` 文案迁移到 next-intl

## 三、现状事实（代码依据，均已在本次设计中核实）

| 事实 | 位置 |
|---|---|
| 调度器双路径已支持自定义邮箱，**零改动可用** | `automation-scheduler.ts:319-339` |
| 分组与去重键为 `userId:mailboxKey` | `automation-scheduler.ts:555` |
| 邮箱表 upsert 为**全字段覆盖** | `mailboxes.ts:145-155` |
| 加密密钥回退到 `JWT_SECRET` | `mailboxes.ts:51` |
| 删除邮箱**未清理游标** | `mailboxes.ts:195-218` |
| 通知是**从 runs/actions 表实时派生**，无通知表可插入 | `store.ts:2163-2320` |
| `email_failed` kind 仅来自失败的 email 类 run action | `store.ts:2282` |
| `automationRowToApi` 已返回 `mailboxKey`/`mailboxLabel` | `store.ts:2469-2470` |
| 创建/更新自动化时 `mailboxKey`/`mailboxLabel` **无校验** | `store.ts:725-727`、`875-877` |
| 创建邮箱接口保存前**真实连接 IMAP 验证**，失败即 400 | `pages/api/v1/automation-mailboxes/index.ts:52-63` |
| 前端冲突检测与规则测试**未按邮箱隔离** | `page.tsx:663-681`、`683-754` |
| `triggerDetail` 硬编码"系统邮箱" | `page.tsx:1292-1299`、`1101-1105` |
| 邮件模板描述写死"系统邮箱收到新邮件" | `page.tsx:387`、`411` |
| 系统设置 SMTP 密码**明文回传前端**（本次不修改，仅记录） | `system-settings/page.tsx:195` |
| 测试基建：`node --experimental-strip-types --test test/*.test.ts`，测试直接 import lib 纯函数 | `package.json:11`、`test/chatSse.test.ts` |

### 系统邮箱的完整触点清单（下线范围）

| 位置 | 内容 |
|---|---|
| `automation-scheduler.ts:299-317` | `fetchSystemMailboxUnread`（调 `/api/v1/email/unread`） |
| `automation-scheduler.ts:324` | `if (mailboxKey === "system")` 分支 |
| `automation-scheduler.ts:357,376,377,456,554,567` | `"系统邮箱"` / `"system"` 兜底值 |
| `store.ts:725-726,875-876` | 创建/更新时的 `"system"` / `"系统邮箱"` 默认值 |
| `store.ts:1965,2011,2556,2580` | 底层函数的 `\|\| "system"` 兜底 |
| `store.ts:2412,2469-2470` | 展示层兜底标签 |
| `page.tsx:628,1105,1296,1298,1349-1350` | 写死的 `mailboxKey`/`mailboxLabel` |
| `page.tsx:3020-3059` | 向导的"固定监听系统邮箱"卡片 |
| `page.tsx:3762` | 运行详情邮箱显示兜底 |
| `page.tsx:387,411` | 模板文案 |
| `pages/api/v1/automation-email/claim.ts:15` | HTTP 端点的 `"system"` 兜底（该端点本身是死代码） |

**下线后 `/api/v1/email/unread` 在本仓库将无任何调用方**（已核实仅 `check-email.ts` 与调度器 system 分支调用，两者都删）。ragent-service 侧该端点可保留，本平台不再调用。

## 四、模块设计

### 模块 A：系统邮箱下线

系统邮箱退场是破坏性变更，但**该功能从未被实际使用**（已确认），因此**无需发布说明、无需备份、无需迁移公告**，也没有存量兼容负担。

1. **防御性清理**（在 `ensureAutomationTables()` 中追加一条幂等清理语句）：

```sql
DELETE FROM automation_tasks
WHERE trigger_type='邮件触发'
  AND trigger_config->>'mailboxKey' = 'system';
```

- WHERE 严格限定 `trigger_type='邮件触发'` 且 `mailboxKey` **等于** `'system'`——等于判断不匹配 NULL，确保不误伤其他触发类型的自动化。
- **预期影响 0 行**。保留这条语句是防御性的：万一实际存在残留行，避免其在新代码下每 10 秒产生一次调度错误日志。天然幂等。
- 这是本方案唯一的破坏性语句，仍需在 review 时确认 WHERE 范围（防的是误伤其他任务，与存量数据无关）。

2. **关联数据清理**：三张邮件表（cursors / processed_messages / rule_events）**无需单独清理**——它们由模块 D.1 的空表重建一并替换（`system` 行随旧表一起消失）。

3. **运行历史**：`automation_runs` 表无外键级联，即便有历史运行记录也不受影响。

4. **拒绝新建/更新为 system**：`mailboxKey` 不再接受 `"system"`，返回明确错误「系统邮箱已下线，请配置监听邮箱」。

5. **代码清理**：删除 `fetchSystemMailboxUnread` 与 `mailboxKey === "system"` 分支；`fetchConfiguredMailboxUnread` 简化为唯一路径。所有 `|| "system"` / `|| "系统邮箱"` 兜底改为显式校验并抛错（避免静默落入已下线分支）。

6. **保留防循环判断**（`automation-scheduler.ts:483`）：结果邮件可能从用户自己的邮箱发出，主题前缀判断仍需保留。

### 模块 B：向导内联邮箱配置（主路径）

`app/automation/page.tsx` step 2 的邮件触发区块，把当前写死的"系统邮箱（固定监听）"卡片改为可选可配：

```
监听邮箱  [ 销售部邮箱 sales@corp.com  ▾ ]
          ├ 销售部邮箱 sales@corp.com     ← 已保存的自定义邮箱（本用户）
          └ ＋ 配置新邮箱…                 ← 选中后展开内联表单
                IMAP 服务器 / 端口 / 账号 / 密码 / 文件夹
                [ 测试连接 ]
                ⚠ 该邮箱已被 N 个自动化使用，修改凭据会影响它们
```

- 选中"＋ 配置新邮箱…"展开内联表单；测试通过后调 `POST /api/v1/automation-mailboxes` 保存，从响应的 `id` 写入本次自动化的 `mailboxId`。
- 邮箱来源：`GET /api/v1/automation-mailboxes`（已存在）。
- 无已保存邮箱时，下拉默认落在"＋ 配置新邮箱…"并自动展开表单（避免空状态死路）。
- `buildAutomationPayload()` 的 `mailboxId`/`mailboxLabel` 从选择派生，移除写死逻辑。
- `triggerDetail()`（`page.tsx:1292`）与 `localizedTriggerDetail`（`page.tsx:1101`）中的硬编码"系统邮箱"改为使用选中的邮箱标签。
- 邮件模板描述（`page.tsx:387`、`411`）中的"系统邮箱"改为"监听邮箱"。
- `resetWizard()` / `openEditDialog()` / `useTemplate()` 同步处理邮箱字段。

**必须处理的三个陷阱**：
1. **密码不得被空值覆盖**：编辑已有邮箱时密码留空表示不修改，需在邮箱更新逻辑中区分"未提供"与"提供空串"。
2. **不得每次保存自动化都写邮箱**：仅在用户实际改动邮箱配置时才发起邮箱写入请求，否则会重置共享凭据并额外触发一次 IMAP 连接。
3. **邮箱不可达时无法保存**：POST 接口保存前会真实连接 IMAP，失败返回 400。内联场景下需给出明确提示（当前设计接受此约束，安全优先）。

### 模块 C：轻量邮箱管理入口（次级）

职责仅限"改密码 / 删除 / 看连接状态"，与向导内联配置不重复。

- 自动化页头部新增次级入口按钮（"邮箱管理"）→ 抽屉组件 `app/automation/components/MailboxManager.tsx`，列表展示：名称 / 邮箱 / IMAP 服务器 / 状态徽标（`connected` / `error`）/ 最后错误。
- **编辑（新增后端能力）**：`lib/automation/mailboxes.ts` 新增 `updateAutomationMailbox`（更新前同样真实连接验证一次，密码留空则保留原值）；`pages/api/v1/automation-mailboxes/[id].ts` 新增 `PUT` 分支。
- **删除**：复用现有 `DELETE`（已有 409 + dependents 依赖检查）。
- **编辑邮箱时必须重置游标**（见模块 D）。
- 新组件使用 next-intl `useTranslations` + `messages/` 文案，遵守 AGENTS.md 规范；不改动自动化页存量 `tt()` 文案。

### 模块 D：数据一致性与服务端校验

**D.1 键格式统一为 mailboxId（数据模型改造，本模块其余各项与其他模块的前提）**

`mailbox:<id>` 字符串编码的唯一存在理由是让 `"system"` 能成为一个合法值。system 退场后，每个键都只是被编码成字符串的整数，这层编码成为纯粹累赘。趁三张表均为空（功能从未使用）一次改到位：

- `trigger_config.mailboxKey: "mailbox:12"` → `trigger_config.mailboxId: 12`（整数）
- 三张表的 `mailbox_key VARCHAR(128)` → `mailbox_id INTEGER`：`automation_email_mailbox_cursors`（主键）、`automation_email_processed_messages`（唯一键）、`automation_email_rule_events`（唯一键）
- 删除调度器的 `mailboxIdFromKey()` 正则解析；分组键由 `${userId}:${mailboxKey}` 改为 `${userId}:${mailboxId}`
- 邮箱记录 API 的 `key: "mailbox:${id}"` 字段取消，直接暴露 `id`

**实现方式：重建空表，不做迁移。**

`CREATE TABLE IF NOT EXISTS` 对已存在的表不执行任何操作，因此仅修改 `CREATE` 语句**不会**改变现有表结构。而这三张表很可能已经存在——`ensureAutomationTables()` 不止在启动时执行，它在 31 处 store 函数开头都会调用；只要平台使用过**任何**自动化（包括与邮件无关的定时触发），这三张表就已被按旧结构建出。

由于表为空，最简做法是**删除空表后由 `CREATE TABLE IF NOT EXISTS` 按新结构重建**，而非编写迁移：

```sql
-- 三张表各一段；仅当旧结构存在且表为空时删除
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'automation_email_mailbox_cursors'
               AND column_name = 'mailbox_key')
     AND NOT EXISTS (SELECT 1 FROM automation_email_mailbox_cursors LIMIT 1)
  THEN
    DROP TABLE automation_email_mailbox_cursors;
  END IF;
END $$;
```

- **自我失效**：执行过一次后列名已变，条件不再成立，此后每次启动均为 no-op。
- **非破坏性**：只删除空表；**若检测到表非空则抛错中止**，而非静默跳过——静默跳过会留下新旧列并存的错配，比启动报错更难排查。
- **并发安全**：`DROP TABLE` 取锁后会重新检查，不会误删。

本方案**不需要**：`ALTER COLUMN ... TYPE INTEGER`、`RENAME COLUMN`、expand-contract 展开、版本化迁移表、独立迁移脚本。上面的列变化是**新表的结构定义**，直接写在 `CREATE TABLE` 语句里即可。

**注**：`automation_tasks` 不能删（其中含定时触发等其他类型的真实数据），其 `trigger_config` 内遗留的 `mailboxKey` 由模块 A 的 `DELETE` 清理——那是数据清理，不涉及 DDL。

**D.2 mailboxId 归属校验**：`store.ts` 的 `createAutomation`（725-727）与 `updateAutomation`（875-877）邮件分支中，`mailboxId` 必须是正整数，并调用 `getAutomationMailboxForUser(userId, mailboxId)` 校验归属，不存在则抛错（不再有 `system` 特例）。

**D.3 mailboxLabel 服务端派生**：忽略客户端传入的 `mailboxLabel`，一律由邮箱记录派生（避免伪造显示）。

**D.4 游标重置**：邮箱的 IMAP 主机 / 账号 / 文件夹变更后，UID 基线完全不同，必须将该邮箱的游标置为 `initialized=false`，否则会漏邮件或重复处理。

**D.5 删除邮箱清理游标**：`deleteAutomationMailbox` 中一并删除 `automation_email_mailbox_cursors` 对应行，避免 id 复用导致游标串号。

**D.6 规则逻辑去重**：抽取 `lib/automation/mail-rules.ts` 纯函数模块，承载 `doesMailRuleMatch` / `mailRulesSummary` / `mailRuleText` / 字段取值提取，以及规范化类型定义。调度器（`automation-scheduler.ts:242-297`）与前端测试器（`page.tsx:322-371`）均改为 import 该模块，消除双份维护。

**D.7 前端冲突检测按邮箱隔离**：`mailConflictCandidates`（`page.tsx:663-681`）与 `mailRuleTestResult`（`page.tsx:683-754`）的过滤条件增加 `mailboxId` 相等判断，并随邮箱选择联动重算。**修复原因**：调度器只在同一 `userId:mailboxId` 分组内做优先级竞争，前端跨邮箱比较会误报冲突并预测错误的 winner。

**D.8 死代码清理**：删除 `pages/api/automation/check-email.ts`、`pages/api/automation/send-email.ts`、`pages/api/v1/automation-email/claim.ts`（全仓库含文档均无引用；调度器直接调用 store 函数，不经 HTTP）、`page.tsx:462` 的 `LEGACY_DEMO_AUTOMATION_NAMES`。

### 模块 E：健壮性改进

1. **邮箱状态与告警**：`automation_mailboxes` 新增 `last_error` / `last_error_at` 列。连接失败时更新状态为 `error` 并记录错误；成功后恢复 `connected`。
2. **连接失败通知**：现有通知机制是从 `automation_runs` / `automation_run_actions` **实时派生**的，没有通知表可插入，且邮箱连接失败时没有 run 记录。因此：
   - `listAutomationNotifications` 的派生逻辑新增第三段查询，来源为 `automation_mailboxes` 中 `status='error'` 的记录，kind 复用已有的 `email_failed`。
   - **eventKey 固定为 `mailbox-error:${mailboxId}`（不含时间戳）**：因此邮箱恢复前该提醒只存在一条、状态稳定；邮箱恢复后提醒自动消失。前端的 toast 去重（`page.tsx:593` 的 `toastedNotificationKeysRef`，按 eventKey 去重）已能防止重复弹窗，无需额外的服务端去抖逻辑。
   - **注**：系统邮箱退场后所有邮箱都有 `automation_mailboxes` 行，因此无需新建独立的健康状态表。
3. **加密密钥前置条件**：`AUTOMATION_MAILBOX_SECRET` 当前不在 `env.example` 中，代码回退到 `JWT_SECRET`（`mailboxes.ts:51`）。**风险**：未显式配置时，轮换 `JWT_SECRET` 会导致所有已存邮箱密码永久无法解密（AES-GCM 认证失败）。处理：写入 `env.example` 并标注为部署前置条件；解密失败时返回明确错误码而非 500。
4. **去重表保留期**：`automation_email_processed_messages` 无界增长，增加定时清理（保留 30 天，随调度器每日执行一次）。

## 五、数据模型变更

| 表 | 变更 | 用途 |
|---|---|---|
| `automation_mailboxes` | 新增 `last_error` / `last_error_at` 列 | 邮箱连接状态与告警（模块 E.1） |
| `automation_tasks` | `trigger_config.mailboxKey`（字符串）→ `mailboxId`（整数）；幂等防御性清理 system 邮箱任务（预期 0 行） | 键格式统一（模块 D.1）；系统邮箱下线（模块 A.1） |
| `automation_email_mailbox_cursors` | 空表重建：`mailbox_key VARCHAR(128)` → `mailbox_id INTEGER`（主键列） | 键格式统一（模块 D.1） |
| `automation_email_processed_messages` | 空表重建：`mailbox_key VARCHAR(128)` → `mailbox_id INTEGER`（唯一键列） | 键格式统一（模块 D.1） |
| `automation_email_rule_events` | 空表重建：`mailbox_key VARCHAR(128)` → `mailbox_id INTEGER`（唯一键列） | 键格式统一（模块 D.1） |

**无新增表，无迁移脚本。** 三张邮件表通过"空表删除 + `CREATE TABLE IF NOT EXISTS` 重建"完成结构变化（模块 D.1），非空则抛错中止。

## 六、API 变更

| 端点 | 变更 |
|---|---|
| `GET/POST /api/v1/automation-mailboxes` | 已存在；响应取消 `key: "mailbox:<id>"` 字段，直接暴露整数 `id` |
| `PUT /api/v1/automation-mailboxes/[id]` | **新增**（编辑，含真实连接验证、密码留空保留原值、游标重置） |
| `DELETE /api/v1/automation-mailboxes/[id]` | 已存在；增加游标清理 |
| `POST/PUT /api/v1/automations` | 增加 mailboxId 归属校验、拒绝 system、label 服务端派生 |
| `GET /api/v1/automation-email/stats` | 无变更（前端在用） |
| `POST /api/v1/automation-email/claim` | **删除**（死代码） |
| `/api/system` 的 `smtp_config` | **不变**（发信，与本次无关） |

## 七、测试与验收

**单元测试**（`pnpm test`，沿用 `node --experimental-strip-types --test`，纯函数可直接 import）：
- `lib/automation/mail-rules.ts`：各字段 × 各操作符组合、AND/OR 模式、边界值（空值、大小写、附件扩展名提取）
- `lib/automation/mailboxes.ts`：加解密往返、密码留空保留原值的更新语义

**手工验收**：
1. 向导内联配置邮箱（正确凭据 / 错误密码两条路径）→ 保存 → 自动化创建成功
2. 无已保存邮箱时，向导默认展开"配置新邮箱"表单
3. 向该邮箱发测试邮件 → 触发运行 → 运行详情显示邮件来源与命中规则
4. 同一邮箱配置两个自动化 → 冲突提示与 winner 预测与实际一致
5. 不同邮箱的两个自动化 → **不产生**冲突提示
6. 编辑邮箱主机 → 确认游标重置、不重复处理历史邮件
7. 删除被引用的邮箱 → 409 拦截提示
8. 尝试提交 `mailboxId` 指向他人邮箱或非法值 → 被拒绝并提示
9. 清理语句执行后，**其他触发类型的自动化与自定义邮箱自动化均不受影响**（这是删除语句的关键回归点）
10. 邮箱连接失败 → 通知中心出现一条提醒（邮箱恢复后自动消失）+ 状态标记为 error

## 八、外部依赖

**无。** 系统邮箱退场后，平台不再需要 ragent-service 新增 `imap_config` 读写、IMAP 测试端点，也不需要修改 `/api/v1/email/unread`。

本次仅依赖 ragent-service 已有的两个端点，均在现有代码中正常使用：
- `POST /api/v1/email/unread-config`（自定义邮箱收信，`mailbox-client.ts` 已在用）
- `POST /api/v1/email/send`（结果邮件发送，`actions.ts` 已在用，本次不改）

## 九、已决策事项

**系统邮箱退场**（2026-09-11 确认）：不再提供平台级共享监听邮箱，所有邮件触发自动化必须绑定用户自己配置的邮箱。

- **理由**：原设计下系统邮箱为平台级共享但分组按用户隔离，同一封邮件会被 N 个用户各自的自动化各触发一次（例如三人各建"客户询价处理"→ 一封询价被处理 3 次，可能重复回信或重复建单）。
- **取舍**：失去了"管理员配置一次、全员可用"的便利，非技术用户需要自己提供企业邮箱授权码。这是有意的选择。
- **存量处置**：**该功能从未被实际使用**（已确认），因此无存量数据、无兼容负担、无需发布说明或备份。仅保留一条防御性清理语句（模块 A）。

**键格式统一为 mailboxId**（2026-09-11 确认）：`mailbox:<id>` 字符串编码的唯一存在理由是让 `"system"` 成为合法值；system 退场后该编码成为累赘。趁三张表为空一次改到位（模块 D.1）。**这是唯一一次无需数据迁移即可变更该结构的窗口。**

**不阻止重复注册同一物理邮箱**（2026-09-11 确认）：用户自行负责邮箱配置，平台不检测、不警告、不阻止把同一物理邮箱注册成多条记录。

### 行为说明：邮箱记录唯一性边界

记录此项是为了说明系统属性，**不是风险警示**——两人各自在同一部署上给同一共享邮箱配置自动化属于协作失误，并非正常用法；且模块 B 的邮箱下拉会列出用户已有邮箱，用户自然会选择既有记录而非重录凭据，同用户重复这条路径也基本被交互堵住。

- **物理身份 ≠ 记录唯一性**：邮箱的物理身份是 `(imap_host, imap_port, username, folder)`，而唯一约束是 `UNIQUE(created_by_user_id, email)`（`mailboxes.ts:37`），按用户、按 `email` 标签约束，与物理身份无关。
- **每个 `mailboxId` 是一条独立管道**：独立游标（主键含 `created_by_user_id`）、独立去重（`claimAutomationEmailMessage` 去重键含 `created_by_user_id`，`store.ts:1971`）。
- **优先级只在同一 `userId:mailboxId` 分组内生效**（`scheduler.ts:555`）。同一邮箱的多个自动化挂在**同一条记录**上时优先级正常生效；挂在两条记录上则互不知情、各自执行。向导现有文案已向用户说明该机制（`page.tsx:3122`），无需额外提示。

## 十、建议实施顺序

按"先改数据模型、再修地基、然后做界面、最后下线共享概念"排列，每步可独立验证：

1. **模块 D.1 键格式统一为 mailboxId**（含三张空表重建）——**必须最先做**：归属校验、分组键、游标逻辑都建立在 D.1 之上，后做会导致大量返工
2. **模块 D.6 规则逻辑去重**（抽 `mail-rules.ts` + 单测）——纯重构，无行为变更，为后续修改提供单一事实来源
3. **模块 D.2/D.3/D.8 服务端校验与死代码清理**——不依赖任何 UI，独立可测
4. **模块 B 向导内联邮箱配置**（含 D.7 冲突检测隔离）——主路径，用户价值最高
5. **模块 C 轻量邮箱管理入口**（含 PUT 端点、D.4 游标重置、D.5 游标清理）
6. **模块 E 健壮性改进**（状态列、通知派生、密钥前置条件、保留期）
7. **模块 A 系统邮箱下线**——放在最后，与模块 B/C 同一次发布：删除 `fetchSystemMailboxUnread`、`mailboxKey === "system"` 分支及各处 `|| "system"` 兜底，并加入 `automation_tasks` 的防御性清理语句

## 十一、验收标准

- 用户可在创建自动化时完成邮箱配置，无需离开向导
- 邮箱配置错误在向导内即时反馈，不会产生静默失败的自动化
- 多邮箱场景下冲突检测与优先级预测与实际调度行为一致
- 邮箱连接失败可被用户感知（通知 + 状态标记），而非仅存在于服务端日志
- 规则匹配逻辑单一来源，前后端行为不可能分叉
- 系统邮箱下线后，代码中不再存在任何 system 分支或 `\|\| "system"` 兜底，也不再存在 `mailbox:<id>` 字符串编解码
- 防御性清理语句的 WHERE 范围经确认，不会误伤其他触发类型的自动化
- 同一邮箱的多个自动化挂在同一条邮箱记录上时，优先级机制正常生效（同一封邮件只执行优先级最高的一条）
- `pnpm test` 与 `pnpm check:ci` 通过
