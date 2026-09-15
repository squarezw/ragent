-- ============================================================================
-- 自动化功能的数据表
-- ============================================================================
--
-- 这是一份**部署时执行**的建表脚本，不是迁移框架的产物。自动化表的结构从此以本文件
-- 为准，应用进程不再创建任何表（见 lib/automation/schema.ts 的 assertAutomationTablesReady）。
--
-- ## 怎么执行
--
--     docker exec -i postgres psql -v ON_ERROR_STOP=1 -U postgres -d ragent \
--       < db/automation.sql
--
-- `-v ON_ERROR_STOP=1` 是必须的：任何一条语句失败（尤其是下面两段自检）都必须立刻
-- 停下，而不是继续跑完后面的 CREATE 留下一半结构。
--
-- 目标库就是应用 DATABASE_URL 指的那个库（默认 `ragent`）。**不要单独建库** ——
-- 全平台只有一个连接池，自动化代码要和 users / apps 同库才查得到它们。
--
-- ## 改这个文件时的铁律
--
-- 所有 CREATE 都带 IF NOT EXISTS —— 表已存在时**整条语句静默跳过**。所以：
--
--   ❌ 给**已存在**的表加列/改类型，不能靠改下面的 CREATE TABLE
--      （在已经有这张表的库上它根本不会执行，结果是"代码与库静默错配"）
--   ✅ 必须在本文件末尾追加显式的 ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--
-- 新增一张表则直接加 CREATE TABLE 即可：全新库和已有库都会正确建出。
--
-- ## 范围
--
-- 只有 automation_* 这 10 张表。其余功能的表（document_file_versions、
-- system_settings 等）仍由各自模块处理，不在本文件内。
-- ============================================================================


-- ── 自检 1：拒绝旧结构（mailbox_key 字符串键）────────────────────────────────
--
-- mailboxId 之前，三张邮件表用 `mailbox_key VARCHAR(128)` 存字符串键。那段结构已废弃，
-- 且与下面的 CREATE 不兼容 —— 但 IF NOT EXISTS 会**静默跳过**已存在的旧表，于是库停在
-- 旧结构上，直到运行时才报 "column mailbox_id does not exist"。这里提前拦住。
--
-- 这些表在升级时按设计必然为空（有数据时旧代码会主动抛错中止），所以安全出口是删表重来。
DO $$
DECLARE
  stale text;
BEGIN
  SELECT string_agg(DISTINCT table_name, ', ') INTO stale
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name LIKE 'automation\_%'
     AND column_name = 'mailbox_key';

  IF stale IS NOT NULL THEN
    RAISE EXCEPTION
      '检测到旧结构：% 仍含 mailbox_key 列，本脚本不会重建已存在的表。'
      '请确认这些表为空后 DROP 掉，再重新执行本脚本。', stale;
  END IF;
END $$;


-- ── 自检 2：报告已存在的自动化表 ─────────────────────────────────────────────
--
-- 不拦截（重复执行本脚本是正常操作），但必须让操作者看见：IF NOT EXISTS 对这些表
-- 什么都不做，**包括不校验其结构是否与下面的 CREATE 一致**。
DO $$
DECLARE
  existing text;
BEGIN
  SELECT string_agg(relname, ', ' ORDER BY relname) INTO existing
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname LIKE 'automation\_%';

  IF existing IS NOT NULL THEN
    RAISE WARNING
      '以下自动化表已存在，本脚本会跳过它们的 CREATE，也不会校验结构与本文件是否一致：%',
      existing;
  END IF;
END $$;


-- ── 表结构 ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS automation_tasks (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  created_by_user_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  app_id INTEGER NOT NULL,
  agent_name VARCHAR(200) NOT NULL DEFAULT '',
  task TEXT NOT NULL,
  trigger_type VARCHAR(64) NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  strategy VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  result_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_run_status VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_tasks_owner
  ON automation_tasks(created_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_tasks_tenant
  ON automation_tasks(tenant_id, created_at DESC);

-- 调度器每分钟的扫描入口，条件与 WHERE 子句完全一致，因此是部分索引。
CREATE INDEX IF NOT EXISTS idx_automation_tasks_due
  ON automation_tasks(status, trigger_type, next_run_at)
  WHERE status = 'running' AND trigger_type = '定时触发';


CREATE TABLE IF NOT EXISTS automation_runs (
  id SERIAL PRIMARY KEY,
  automation_id INTEGER,
  tenant_id INTEGER,
  created_by_user_id INTEGER NOT NULL,
  automation_name VARCHAR(200) NOT NULL,
  app_id INTEGER NOT NULL,
  agent_name VARCHAR(200) NOT NULL DEFAULT '',
  trigger_type VARCHAR(64) NOT NULL,
  trigger_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  task_snapshot TEXT,
  strategy_snapshot VARCHAR(64),
  result_config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL,
  result TEXT,
  ai_result TEXT,
  review_content TEXT,
  final_result TEXT,
  result_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_version INTEGER NOT NULL DEFAULT 0,
  review_status VARCHAR(20) NOT NULL DEFAULT 'not_required',
  reviewer_user_id INTEGER,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  action_status VARCHAR(20) NOT NULL DEFAULT 'not_started',
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_owner
  ON automation_runs(created_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_automation
  ON automation_runs(automation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_review
  ON automation_runs(created_by_user_id, status, created_at DESC)
  WHERE status IN ('pending', 'regenerating');


CREATE TABLE IF NOT EXISTS automation_run_review_history (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  ai_version INTEGER,
  content TEXT,
  note TEXT,
  actor_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_run_review_history_run
  ON automation_run_review_history(run_id, created_at ASC, id ASC);


CREATE TABLE IF NOT EXISTS automation_run_actions (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  action_key VARCHAR(64) NOT NULL,
  action_type VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, action_key)
);

CREATE INDEX IF NOT EXISTS idx_automation_run_actions_run
  ON automation_run_actions(run_id, id ASC);

CREATE INDEX IF NOT EXISTS idx_automation_run_actions_pending
  ON automation_run_actions(run_id, status, id ASC);


CREATE TABLE IF NOT EXISTS automation_email_processed_messages (
  id SERIAL PRIMARY KEY,
  created_by_user_id INTEGER NOT NULL,
  mailbox_id INTEGER NOT NULL,
  message_key VARCHAR(500) NOT NULL,
  automation_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_email_processed_once_per_automation
    UNIQUE (created_by_user_id, mailbox_id, message_key, automation_id)
);

CREATE INDEX IF NOT EXISTS idx_automation_email_processed_owner
  ON automation_email_processed_messages(created_by_user_id, created_at DESC);


CREATE TABLE IF NOT EXISTS automation_email_mailbox_cursors (
  created_by_user_id INTEGER NOT NULL,
  mailbox_id INTEGER NOT NULL,
  last_uid BIGINT NOT NULL DEFAULT 0,
  initialized BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (created_by_user_id, mailbox_id)
);

CREATE INDEX IF NOT EXISTS idx_automation_email_cursor_updated
  ON automation_email_mailbox_cursors(updated_at DESC);


CREATE TABLE IF NOT EXISTS automation_email_rule_events (
  id SERIAL PRIMARY KEY,
  created_by_user_id INTEGER NOT NULL,
  mailbox_id INTEGER NOT NULL,
  message_key VARCHAR(500) NOT NULL,
  message_uid BIGINT,
  automation_id INTEGER NOT NULL,
  outcome VARCHAR(40) NOT NULL,
  matched_rule TEXT,
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  message_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(created_by_user_id, mailbox_id, message_key, automation_id)
);

CREATE INDEX IF NOT EXISTS idx_automation_email_rule_events_automation
  ON automation_email_rule_events(created_by_user_id, automation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_email_rule_events_mailbox
  ON automation_email_rule_events(created_by_user_id, mailbox_id, created_at DESC);


CREATE TABLE IF NOT EXISTS automation_notification_preferences (
  user_id INTEGER PRIMARY KEY,
  initialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS automation_notification_states (
  user_id INTEGER NOT NULL,
  event_key VARCHAR(255) NOT NULL,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_automation_notification_states_user
  ON automation_notification_states(user_id, updated_at DESC);


CREATE TABLE IF NOT EXISTS automation_mailboxes (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  created_by_user_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(320) NOT NULL,
  username VARCHAR(320) NOT NULL,
  -- AES-GCM 密文。密钥优先取 AUTOMATION_MAILBOX_SECRET，未配置时回退 JWT_SECRET；
  -- 换掉那个密钥会让这里的旧密文永久解不开（见 lib/automation/mailboxes.ts）。
  password_ciphertext TEXT NOT NULL,
  imap_host VARCHAR(255) NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_secure BOOLEAN NOT NULL DEFAULT TRUE,
  folder VARCHAR(255) NOT NULL DEFAULT 'INBOX',
  status VARCHAR(20) NOT NULL DEFAULT 'connected',
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(created_by_user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_automation_mailboxes_owner
  ON automation_mailboxes(created_by_user_id, created_at DESC);


-- ── 一次性数据清理（非 DDL）─────────────────────────────────────────────────
--
-- 系统邮箱已下线：任何仍带 mailboxKey='system' 的邮件触发任务都没有可用的整数 mailboxId，
-- 调度器每次扫描都会对它们抛 MAILBOX_ID_REQUIRED、每 10 秒刷一条错误日志。
--
-- WHERE 严格限定"邮件触发 + mailboxKey 恰好等于 'system'"：等于判断不匹配 NULL，
-- 其他触发类型、以及自定义邮箱的 mailboxId 行都不受影响。预期影响 0 行。
-- 放在这里而非应用代码里，是因为应用已经不再执行任何写 DDL/清理语句了。
DELETE FROM automation_tasks
 WHERE trigger_type = '邮件触发'
   AND trigger_config->>'mailboxKey' = 'system';


-- ── 迁移：一封邮件从「只允许一条自动化领取」改为「每条各领一次」────────────────
--
-- 唯一键不含 automation_id 时，第二条规定连 claim 都过不去（ON CONFLICT DO NOTHING 直接冲突），
-- 无论调度器怎么写。加列即开关。
--
-- DROP IF EXISTS + 条件 ADD 同时适配两种库：全新库（上面的 CREATE 已建好新约束，两段都是
-- no-op）与已存在的库（旧约束在、新约束不在，正常迁移）。条件 ADD 的写法沿用
-- lib/documentFileVersions.ts 里的既有惯用法 —— PostgreSQL 不支持 ADD CONSTRAINT IF NOT EXISTS。
--
-- 「两段迁移」与本次代码必须同批上线。唯一键这段是开关：没有它，新代码的 claim 一次都过不去
-- （ON CONFLICT 找不到目标约束，42P10）；下面的 DROP COLUMN 那段则相反 —— 先删列会让**旧代码**
-- 的事件 INSERT 报 column ... does not exist（旧代码仍列着 priority / winner_automation_id）。
-- 真要拆开就按「先代码、后 SQL」：那时的失败是响的，且两种顺序都不丢数据。
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


-- ── 迁移：优先级与「胜出者」概念废弃（改为一封邮件命中的每条自动化都执行）────────
--
-- 两列都是 DROP IF EXISTS：全新库上面已不声明它们（no-op），旧库在这里被清掉。
ALTER TABLE automation_email_rule_events DROP COLUMN IF EXISTS priority;
ALTER TABLE automation_email_rule_events DROP COLUMN IF EXISTS winner_automation_id;


-- ── 结果 ────────────────────────────────────────────────────────────────────

SELECT '自动化表 ' || count(*) || ' 张' AS result
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND c.relname LIKE 'automation\_%';
