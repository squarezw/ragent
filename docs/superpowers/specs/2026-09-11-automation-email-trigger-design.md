# 邮件触发功能完善与平台集成 设计方案

日期：2026-09-11
状态：待评审

## 一、目标

邮件触发的执行链路（服务端调度器每 10 秒轮询邮箱 → 规则匹配 → 优先级竞争 → 去重 → 调用数字员工 → 策略分叉）**已经跑通**，但存在两类问题：

1. **能力已在后端、用户够不着**：自定义监听邮箱的后端（加密存储、真实 IMAP 连接验证、依赖检查删除）已完整实现，但前端完全没有入口，自动化向导写死"系统邮箱"；系统邮箱的 IMAP 配置在平台内完全不可见。
2. **已知缺陷**：服务端零校验、前端冲突检测未按邮箱隔离、连接失败无告警、匹配逻辑双份维护、存在死代码。

本方案让用户在**创建自动化时直接配置监听邮箱**，把系统邮箱纳入平台系统设置，并修复上述缺陷。

## 二、范围

**纳入**：
- 向导 step 2 内联配置监听邮箱（主路径）
- 自动化页轻量邮箱管理入口（改密码 / 删除 / 看状态）
- 系统设置新增 IMAP 收信配置（需 ragent-service 配合）
- 服务端校验、冲突检测隔离、连接失败告警、规则逻辑去重、死代码清理

**不纳入（YAGNI）**：
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
| 系统设置 SMTP 密码**明文回传前端** | `system-settings/page.tsx:195` |
| 测试基建：`node --experimental-strip-types --test test/*.test.ts`，测试直接 import lib 纯函数 | `package.json:11`、`test/chatSse.test.ts` |

## 四、模块设计

### 模块 A：系统邮箱 IMAP 配置（系统设置页）

系统邮箱是平台级共享邮箱，由超管维护，沿用现有 SMTP 配置的形态与权限模型。

**ragent-service 侧（外部依赖，需配合）**：
1. system settings 对象新增 `imap_config` 字段（`IMAP_HOST` / `IMAP_PORT` / `IMAP_USERNAME` / `IMAP_PASSWORD` / `IMAP_USE_SSL` / `IMAP_FOLDER`），与现有 `smtp_config` 对称。
2. `/api/v1/email/unread` 改为读取该配置。
3. 新增 IMAP 连接测试端点。

**本仓库**：
- `app/system-settings/page.tsx`：在现有 SMTP 卡片旁新增"系统邮箱（IMAP 收信）" `CollapsibleCard`，含字段表单 + 保存 + "测试连接"按钮。保存复用现有 `PUT /api/system` 代理透传 `imap_config`。
- `pages/api/system/index.ts`：透传 `imap_config`（与 `smtp_config` 同样处理）。
- 新增 `pages/api/system/test-imap.ts`（转发 ragent-service 测试端点，需 super admin 校验）。

**安全要求（不照抄 SMTP 的既有缺陷）**：
- 密码字段**只写**：接口只返回 `hasPassword` 布尔值，不回传密码明文。
- 表单密码留空 = 不修改原值。

**权限**：沿用页面现有 `checkSuperAdmin`。

### 模块 B：向导内联邮箱配置（主路径）

`app/automation/page.tsx` step 2 的邮件触发区块，把当前写死的"系统邮箱（固定监听）"卡片改为可选可配：

```
监听邮箱  [ 系统邮箱（平台）        ▾ ]
          ├ 系统邮箱（平台）
          ├ 销售部邮箱 sales@corp.com     ← 已保存的自定义邮箱（本用户）
          └ ＋ 配置新邮箱…                 ← 选中后展开内联表单
                IMAP 服务器 / 端口 / 账号 / 密码 / 文件夹
                [ 测试连接 ]
                ⚠ 该邮箱已被 N 个自动化使用，修改凭据会影响它们
```

- 选中"＋ 配置新邮箱…"展开内联表单；测试通过后调 `POST /api/v1/automation-mailboxes` 保存，从响应的 `key` 字段取得 `mailbox:<id>` 写入本次自动化的 `mailboxKey`。
- 邮箱来源：`GET /api/v1/automation-mailboxes`（已存在）。
- `buildAutomationPayload()` 的 `mailboxKey`/`mailboxLabel` 从选择派生，移除写死逻辑。
- `triggerDetail()`（`page.tsx:1292`）与 `localizedTriggerDetail`（`page.tsx:1101`）中的硬编码"系统邮箱"改为使用选中的邮箱标签。
- `resetWizard()` / `openEditDialog()` / `useTemplate()` 同步处理邮箱字段。

**必须处理的三个陷阱**：
1. **密码不得被空值覆盖**：编辑已有邮箱时密码留空表示不修改，需在邮箱更新逻辑中区分"未提供"与"提供空串"。
2. **不得每次保存自动化都写邮箱**：仅在用户实际改动邮箱配置时才发起邮箱写入请求，否则会重置共享凭据并额外触发一次 IMAP 连接。
3. **邮箱不可达时无法保存**：POST 接口保存前会真实连接 IMAP，失败返回 400。内联场景下需给出明确提示（当前设计接受此约束，安全优先）。

### 模块 C：轻量邮箱管理入口（次级）

职责仅限"改密码 / 删除 / 看连接状态"，与向导内联配置不重复。

- 自动化页头部新增次级入口按钮（"邮箱管理"）→ 抽屉组件 `app/automation/components/MailboxManager.tsx`，列表展示：名称 / 邮箱 / IMAP 服务器 / 状态徽标（`connected` / `error`）/ 最后错误。
- **编辑（新增后端能力）**：`lib/automation/mailboxes.ts` 新增 `updateAutomationMailbox`（更新前同样真实连接验证一次）；`pages/api/v1/automation-mailboxes/[id].ts` 新增 `PUT` 分支。
- **删除**：复用现有 `DELETE`（已有 409 + dependents 依赖检查）。
- **编辑邮箱时必须重置游标**（见模块 D）。
- 新组件使用 next-intl `useTranslations` + `messages/` 文案，遵守 AGENTS.md 规范；不改动自动化页存量 `tt()` 文案。

### 模块 D：服务端校验与一致性修复

1. **mailboxKey 归属校验**：`store.ts` 的 `createAutomation`（725-727）与 `updateAutomation`（875-877）邮件分支中，若 `mailboxKey` 形如 `mailbox:<id>`，调用 `getAutomationMailboxForUser(userId, id)` 校验归属，不存在则抛错。
2. **mailboxLabel 服务端派生**：忽略客户端传入的 `mailboxLabel`，一律由邮箱记录派生（避免伪造显示）。`mailboxKey === "system"` 时固定为"系统邮箱"，无对应邮箱表记录。
3. **游标重置**：邮箱的 IMAP 主机 / 账号 / 文件夹变更后，UID 基线完全不同，必须将该 `mailboxKey` 的游标置为 `initialized=false`，否则会漏邮件或重复处理。
4. **删除邮箱清理游标**：`deleteAutomationMailbox` 中一并删除 `automation_email_mailbox_cursors` 对应行，避免 id 复用导致游标串号。
5. **规则逻辑去重**：抽取 `lib/automation/mail-rules.ts` 纯函数模块，承载 `doesMailRuleMatch` / `mailRulesSummary` / `mailRuleText` / 字段取值提取，以及规范化类型定义。调度器（`automation-scheduler.ts:242-297`）与前端测试器（`page.tsx:322-371`）均改为 import 该模块，消除双份维护。
6. **前端冲突检测按邮箱隔离**：`mailConflictCandidates`（`page.tsx:663-681`）与 `mailRuleTestResult`（`page.tsx:683-754`）的过滤条件增加 `mailboxKey` 相等判断，并随邮箱选择联动重算。**修复原因**：调度器只在同一 `userId:mailboxKey` 分组内做优先级竞争，前端跨邮箱比较会误报冲突并预测错误的 winner。
7. **死代码清理**：删除 `pages/api/automation/check-email.ts`、`pages/api/automation/send-email.ts`（全仓库含文档均无引用）、`page.tsx:462` 的 `LEGACY_DEMO_AUTOMATION_NAMES`。

### 模块 E：健壮性改进

1. **连接失败告警**：现有通知机制是从 `automation_runs` / `automation_run_actions` **实时派生**的，没有通知表可插入，且邮箱连接失败时没有 run 记录。因此需新增一个健康状态数据源：
   - 新表 `automation_mailbox_health(user_id, mailbox_key, last_error, last_error_at)`。
   - `listAutomationNotifications` 的派生逻辑新增第三段查询，eventKey 为 `mailbox:<key>:error`，kind 复用已有的 `email_failed`。
   - 带去抖：同一邮箱 10 分钟内最多产生一条提醒。
2. **邮箱状态标记**：连接失败时更新状态为 `error` 并记录最后错误；成功后恢复 `connected`。模块 C 的列表展示该状态。
3. **加密密钥前置条件**：`AUTOMATION_MAILBOX_SECRET` 当前不在 `env.example` 中，代码回退到 `JWT_SECRET`（`mailboxes.ts:51`）。**风险**：未显式配置时，轮换 `JWT_SECRET` 会导致所有已存邮箱密码永久无法解密（AES-GCM 认证失败）。处理：写入 `env.example` 并标注为部署前置条件；解密失败时返回明确错误码而非 500。
4. **去重表保留期**：`automation_email_processed_messages` 无界增长，增加定时清理（保留 30 天，随调度器每日执行一次）。

## 五、数据模型变更

| 表 | 变更 | 用途 |
|---|---|---|
| `automation_mailbox_health` | 新建 | 邮箱连接健康状态与最后错误（模块 E.1） |
| `automation_mailboxes` | 新增 `last_error` / `last_error_at` 列 | 邮箱状态展示（模块 E.2） |
| `automation_email_mailbox_cursors` | 无结构变更 | 删除/编辑邮箱时清理或重置（模块 D.3、D.4） |

## 六、API 变更

| 端点 | 变更 |
|---|---|
| `GET/POST /api/v1/automation-mailboxes` | 已存在，无变更 |
| `PUT /api/v1/automation-mailboxes/[id]` | **新增**（编辑，含真实连接验证、游标重置） |
| `DELETE /api/v1/automation-mailboxes/[id]` | 已存在；增加游标清理 |
| `PUT /api/system` | 透传 `imap_config` |
| IMAP 测试代理端点 | **新增**（super admin 校验） |
| `POST/PUT /api/v1/automations` | 增加 mailboxKey 归属校验、label 服务端派生 |

## 七、测试与验收

**单元测试**（`pnpm test`，沿用 `node --experimental-strip-types --test`，纯函数可直接 import）：
- `lib/automation/mail-rules.ts`：各字段 × 各操作符组合、AND/OR 模式、边界值（空值、大小写、附件扩展名提取）
- `lib/automation/mailboxes.ts`：加解密往返、密码留空保留原值的更新语义

**手工验收**：
1. 向导内联配置邮箱（正确凭据 / 错误密码两条路径）→ 保存 → 自动化创建成功
2. 向该邮箱发测试邮件 → 触发运行 → 运行详情显示邮件来源与命中规则
3. 同一邮箱配置两个自动化 → 冲突提示与 winner 预测与实际一致
4. 编辑邮箱主机 → 确认游标重置、不重复处理历史邮件
5. 删除被引用的邮箱 → 409 拦截提示
6. 系统设置保存 IMAP + 测试连接
7. 邮箱连接失败 → 通知中心出现提醒（10 分钟去抖）

## 八、外部依赖（前置确认项）

**ragent-service 需配合三件事**（模块 A）：
1. system settings 支持 `imap_config` 读写
2. `/api/v1/email/unread` 改用该配置
3. 新增 IMAP 连接测试端点

若 ragent-service 无法配合，模块 A 降级为"完全迁入本仓库"方案：复用自定义邮箱的加密存储模式，为系统邮箱建立每租户一条的 `system` 记录，调度器 `system` 路径改走 `/api/v1/email/unread-config`。

## 九、待确认的语义问题（不阻塞本次实现）

系统邮箱是**平台级共享**的（超管维护），但分组键与去重键均为 `userId:mailboxKey`。因此同一封进入系统邮箱的邮件，**不同用户的自动化可以各自触发一次，互不竞争优先级**。

- 现状语义：按用户隔离（与"自定义邮箱仅创建者本人"的决策一致）——本次实现**保持现状**。
- 若期望"整个平台对同一封邮件只触发一个自动化"，需将分组键与去重键改为不含 `userId`，影响面较大，另行评估。
- 附带影响：N 个用户共用系统邮箱时，会各自独立拉取 IMAP（每 10 秒 N 次连接），大用户量下需关注。

## 十、建议实施顺序

按"先修地基、再做界面、最后接外部依赖"排列，每步可独立验证：

1. **模块 D.5 规则逻辑去重**（抽 `mail-rules.ts` + 单测）——纯重构，无行为变更，为后续修改提供单一事实来源
2. **模块 D.1/D.2/D.7 服务端校验与死代码清理**——不依赖任何 UI，独立可测
3. **模块 B 向导内联邮箱配置**（含 D.6 冲突检测隔离）——主路径，用户价值最高
4. **模块 C 轻量邮箱管理入口**（含 PUT 端点、游标重置/清理、D.3/D.4）
5. **模块 E 健壮性改进**（健康表、状态标记、通知派生、密钥前置条件、保留期）
6. **模块 A 系统邮箱 IMAP 配置**——依赖 ragent-service 配合，可与其他模块并行推进，但**须先确认外部依赖可行性**

## 十一、验收标准

- 用户可在创建自动化时完成邮箱配置，无需离开向导
- 邮箱配置错误在向导内即时反馈，不会产生静默失败的自动化
- 多邮箱场景下冲突检测与优先级预测与实际调度行为一致
- 邮箱连接失败可被用户感知（通知 + 状态标记），而非仅存在于服务端日志
- 规则匹配逻辑单一来源，前后端行为不可能分叉
- `pnpm test` 与 `pnpm check:ci` 通过
