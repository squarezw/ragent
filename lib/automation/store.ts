import pool from "@/lib/db";
import { getUserTenantId } from "@/lib/tenantMapping";

export type AutomationTriggerType = "定时触发" | "邮件触发" | "Webhook / API" | "自动化完成触发";

export type AutomationStrategy = "仅生成结果" | "需要确认后执行" | "自动执行";

export type AutomationStatus = "running" | "paused" | "error";

export type MonthlyMissingDayPolicy = "last_day" | "skip";
export type MonthlyMode = "fixed_day" | "last_day";

export interface ScheduleConfig {
  period: "每天" | "每周" | "每月" | "仅一次";
  time: string;
  timezone: string;
  weekdays?: number[];
  weekday?: number; // 兼容历史单星期配置
  monthlyMode?: MonthlyMode;
  dayOfMonth?: number;
  missingDayPolicy?: MonthlyMissingDayPolicy;
  date?: string;
  runAt?: string;
}

let initPromise: Promise<void> | null = null;

export async function ensureAutomationTables() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await pool.query(`
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

      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS task_snapshot TEXT;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS strategy_snapshot VARCHAR(64);
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS result_config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS ai_result TEXT;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS review_content TEXT;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS final_result TEXT;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS result_attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS ai_version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'not_required';
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS reviewer_user_id INTEGER;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS action_status VARCHAR(20) NOT NULL DEFAULT 'not_started';
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
      ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      UPDATE automation_runs
      SET processing_started_at = COALESCE(processing_started_at, started_at)
      WHERE status IN ('running', 'regenerating')
        AND processing_started_at IS NULL;

      UPDATE automation_runs AS run
      SET
        task_snapshot = COALESCE(run.task_snapshot, task.task),
        strategy_snapshot = COALESCE(run.strategy_snapshot, task.strategy),
        result_config_snapshot = CASE
          WHEN (run.task_snapshot IS NULL OR run.strategy_snapshot IS NULL)
            AND run.result_config_snapshot = '{}'::jsonb
          THEN task.result_config
          ELSE run.result_config_snapshot
        END
      FROM automation_tasks AS task
      WHERE run.automation_id = task.id
        AND (run.task_snapshot IS NULL OR run.strategy_snapshot IS NULL);

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
        mailbox_key VARCHAR(128) NOT NULL,
        message_key VARCHAR(500) NOT NULL,
        automation_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(created_by_user_id, mailbox_key, message_key)
      );

      CREATE INDEX IF NOT EXISTS idx_automation_email_processed_owner
        ON automation_email_processed_messages(created_by_user_id, created_at DESC);


      CREATE TABLE IF NOT EXISTS automation_email_mailbox_cursors (
        created_by_user_id INTEGER NOT NULL,
        mailbox_key VARCHAR(128) NOT NULL,
        last_uid BIGINT NOT NULL DEFAULT 0,
        initialized BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (created_by_user_id, mailbox_key)
      );

      CREATE INDEX IF NOT EXISTS idx_automation_email_cursor_updated
        ON automation_email_mailbox_cursors(updated_at DESC);

      CREATE TABLE IF NOT EXISTS automation_email_rule_events (
        id SERIAL PRIMARY KEY,
        created_by_user_id INTEGER NOT NULL,
        mailbox_key VARCHAR(128) NOT NULL,
        message_key VARCHAR(500) NOT NULL,
        message_uid BIGINT,
        automation_id INTEGER NOT NULL,
        outcome VARCHAR(40) NOT NULL,
        winner_automation_id INTEGER,
        matched_rule TEXT,
        priority INTEGER,
        from_address TEXT,
        to_address TEXT,
        subject TEXT,
        message_date TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(created_by_user_id, mailbox_key, message_key, automation_id)
      );

      CREATE INDEX IF NOT EXISTS idx_automation_email_rule_events_automation
        ON automation_email_rule_events(created_by_user_id, automation_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_automation_email_rule_events_mailbox
        ON automation_email_rule_events(created_by_user_id, mailbox_key, created_at DESC);

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
    `);
  })().catch((error) => {
    initPromise = null;
    throw error;
  });

  return initPromise;
}

function scheduleError(code: string): never {
  throw new Error(code);
}

function cleanTimeZone(value?: string, strict = false) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (strict) scheduleError("SCHEDULE_TIMEZONE_REQUIRED");
    return "Asia/Shanghai";
  }

  const zone = raw
    .replace(/\s*（.*?）\s*/g, "")
    .replace(/\s*\(.*?\)\s*/g, "")
    .trim();

  if (!zone) {
    if (strict) scheduleError("SCHEDULE_TIMEZONE_REQUIRED");
    return "Asia/Shanghai";
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    scheduleError("SCHEDULE_INVALID_TIMEZONE");
  }
}

function normalizedScheduleTime(value?: string, strict = false) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (strict) scheduleError("SCHEDULE_TIME_REQUIRED");
    return "09:00";
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    scheduleError("SCHEDULE_INVALID_TIME");
  }
  return raw;
}

function validCalendarDate(value?: string) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseCalendarDate(value: string) {
  if (!validCalendarDate(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const values = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);

  return {
    year,
    month,
    day,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

function sameLocalMinute(
  date: Date,
  target: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string
) {
  const got = zonedParts(date, timeZone);
  return (
    got.year === target.year &&
    got.month === target.month &&
    got.day === target.day &&
    got.hour === target.hour &&
    got.minute === target.minute
  );
}

function zonedDateTimeToUtc(
  target: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string
): Date | null {
  const wantedAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    0,
    0
  );

  let guess = wantedAsUtc;
  for (let i = 0; i < 6; i += 1) {
    const got = zonedParts(new Date(guess), timeZone);
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, 0, 0);
    const delta = wantedAsUtc - gotAsUtc;
    guess += delta;
    if (Math.abs(delta) < 1000) break;
  }

  const candidate = new Date(guess);
  if (!sameLocalMinute(candidate, target, timeZone)) {
    // 夏令时切换时某些当地时间不存在。周期任务会跳过该次，
    // 一次性任务则在保存时提示用户重新选择时间。
    return null;
  }

  // 夏令时结束时，同一个当地时间可能出现两次。固定选择第一次，
  // Scheduler 后续只推进一次 next_run_at，避免同一当地时间重复执行。
  let earliest = candidate;
  for (let minutes = 1; minutes <= 180; minutes += 1) {
    const probe = new Date(candidate.getTime() - minutes * 60_000);
    if (sameLocalMinute(probe, target, timeZone)) earliest = probe;
  }
  return earliest;
}

function addCalendarDays(value: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonths(year: number, month: number, offset: number) {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function normalizeWeekdays(input: unknown, legacyWeekday?: unknown) {
  const values = Array.isArray(input)
    ? input
    : Number.isInteger(legacyWeekday)
      ? [legacyWeekday]
      : [];

  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    )
  ).sort((left, right) => {
    const order = [1, 2, 3, 4, 5, 6, 0];
    return order.indexOf(left) - order.indexOf(right);
  });
}

function formatCalendarDateInZone(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatDateTimeInZone(value: unknown, timeZone: string) {
  const date = new Date(value as any);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date, timeZone);
  return `${parts.year}/${parts.month}/${parts.day} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

type NormalizeScheduleOptions = {
  strict?: boolean;
};

export function normalizeScheduleConfig(
  input: Partial<ScheduleConfig>,
  now = new Date(),
  options: NormalizeScheduleOptions = {}
): ScheduleConfig {
  const strict = options.strict === true;
  const rawPeriod = input.period;
  const validPeriods = new Set(["每天", "每周", "每月", "仅一次"]);

  if (strict && !validPeriods.has(String(rawPeriod || ""))) {
    scheduleError("SCHEDULE_PERIOD_REQUIRED");
  }

  const period = validPeriods.has(String(rawPeriod || ""))
    ? (rawPeriod as ScheduleConfig["period"])
    : "每天";
  const time = normalizedScheduleTime(input.time, strict);
  const timezone = cleanTimeZone(input.timezone, strict);
  const config: ScheduleConfig = { period, time, timezone };

  if (period === "每周") {
    const weekdays = normalizeWeekdays(input.weekdays, input.weekday);
    if (weekdays.length === 0) scheduleError("SCHEDULE_WEEKDAY_REQUIRED");
    config.weekdays = weekdays;
  }

  if (period === "每月") {
    const monthlyMode: MonthlyMode =
      input.monthlyMode === "last_day" ? "last_day" : "fixed_day";
    config.monthlyMode = monthlyMode;

    if (monthlyMode === "last_day") {
      // “每月最后一天”不等同于固定 31 日：2 月自动取 28/29 日，
      // 其他月份自动取各自最后一天。
      config.dayOfMonth = 31;
      config.missingDayPolicy = "last_day";
    } else {
      const requestedDay = Number(input.dayOfMonth);
      const validDay = Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= 31;
      if (!validDay) scheduleError("SCHEDULE_MONTH_DAY_REQUIRED");
      config.dayOfMonth = requestedDay;

      const rawPolicy = input.missingDayPolicy;
      if (
        strict &&
        Number(config.dayOfMonth) >= 29 &&
        rawPolicy !== "last_day" &&
        rawPolicy !== "skip"
      ) {
        scheduleError("SCHEDULE_MONTH_POLICY_REQUIRED");
      }
      config.missingDayPolicy = rawPolicy === "skip" ? "skip" : "last_day";
    }
  }

  if (period === "仅一次") {
    const explicitDate = String(input.date || "").trim();
    let date = validCalendarDate(explicitDate) ? explicitDate : "";

    if (!date && input.runAt) {
      const parsed = new Date(input.runAt);
      if (!Number.isNaN(parsed.getTime())) {
        date = formatCalendarDateInZone(parsed, timezone);
      }
    }

    if (strict && !date) scheduleError("SCHEDULE_DATE_REQUIRED");

    if (date) {
      const parts = parseCalendarDate(date);
      if (!parts) scheduleError("SCHEDULE_INVALID_DATE");
      const [hour, minute] = time.split(":").map(Number);
      const runAt = zonedDateTimeToUtc({ ...parts, hour, minute }, timezone);
      if (!runAt) scheduleError("SCHEDULE_LOCAL_TIME_INVALID");
      config.date = date;
      config.runAt = runAt.toISOString();

      if (strict && runAt.getTime() <= now.getTime()) {
        scheduleError("SCHEDULE_ONCE_EXPIRED");
      }
    } else if (input.runAt) {
      const parsed = new Date(input.runAt);
      if (!Number.isNaN(parsed.getTime())) config.runAt = parsed.toISOString();
    }
  }

  return config;
}

export function computeNextRunAt(
  configInput: Partial<ScheduleConfig>,
  after = new Date()
): Date | null {
  const timezone = cleanTimeZone(configInput.timezone);
  const time = normalizedScheduleTime(configInput.time);
  const period =
    configInput.period === "每周" ||
    configInput.period === "每月" ||
    configInput.period === "仅一次"
      ? configInput.period
      : "每天";

  if (period === "仅一次") {
    if (!configInput.runAt) return null;
    const runAt = new Date(configInput.runAt);
    return !Number.isNaN(runAt.getTime()) && runAt.getTime() > after.getTime() ? runAt : null;
  }

  const [hour, minute] = time.split(":").map(Number);
  const localNow = zonedParts(after, timezone);
  const makeCandidate = (year: number, month: number, day: number) =>
    zonedDateTimeToUtc({ year, month, day, hour, minute }, timezone);

  if (period === "每周") {
    const targets = normalizeWeekdays(configInput.weekdays, configInput.weekday);
    if (targets.length === 0) return null;

    for (let offset = 0; offset <= 14; offset += 1) {
      const date = addCalendarDays(localNow, offset);
      const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
      if (!targets.includes(weekday)) continue;
      const candidate = makeCandidate(date.year, date.month, date.day);
      if (candidate && candidate.getTime() > after.getTime()) return candidate;
    }
    return null;
  }

  if (period === "每月") {
    const monthlyMode: MonthlyMode =
      configInput.monthlyMode === "last_day" ? "last_day" : "fixed_day";
    const requestedDay = Number(configInput.dayOfMonth);
    if (monthlyMode === "fixed_day" && (!Number.isInteger(requestedDay) || requestedDay < 1 || requestedDay > 31)) {
      return null;
    }
    const policy: MonthlyMissingDayPolicy =
      configInput.missingDayPolicy === "skip" ? "skip" : "last_day";

    for (let offset = 0; offset <= 24; offset += 1) {
      const targetMonth = addMonths(localNow.year, localNow.month, offset);
      const maxDay = daysInMonth(targetMonth.year, targetMonth.month);

      // Date.UTC(year, month, 0) 会正确计算闰年，因此 2 月最后一天
      // 在闰年为 29 日，普通年份为 28 日。
      if (monthlyMode === "last_day") {
        const candidate = makeCandidate(targetMonth.year, targetMonth.month, maxDay);
        if (candidate && candidate.getTime() > after.getTime()) return candidate;
        continue;
      }

      if (requestedDay > maxDay && policy === "skip") continue;
      const actualDay = requestedDay > maxDay ? maxDay : requestedDay;
      const candidate = makeCandidate(targetMonth.year, targetMonth.month, actualDay);
      if (candidate && candidate.getTime() > after.getTime()) return candidate;
    }
    return null;
  }

  for (let offset = 0; offset <= 2; offset += 1) {
    const date = addCalendarDays(localNow, offset);
    const candidate = makeCandidate(date.year, date.month, date.day);
    if (candidate && candidate.getTime() > after.getTime()) return candidate;
  }
  return null;
}

export async function resolveAppName(appId: number) {
  const result = await pool.query("SELECT name FROM apps WHERE id = $1", [appId]);
  return result.rows[0]?.name ? String(result.rows[0].name) : null;
}

type EmailRuleMode = "all" | "any";

type EmailTriggerRule = {
  id?: string;
  field: string;
  operator: string;
  value?: string;
};

function normalizeEmailRules(input: any): EmailTriggerRule[] {
  if (!Array.isArray(input)) return [];

  const allowedFields = new Set([
    "发件人",
    "发件人域名",
    "收件人",
    "邮件主题",
    "邮件正文",
    "是否包含附件",
    "附件名称",
    "附件类型",
  ]);
  const allowedOperators = new Set(["等于", "包含", "不包含", "开头是", "结尾是", "是否存在"]);

  return input
    .map((rule: any, index: number) => ({
      id: String(rule?.id || `rule-${index + 1}`),
      field: String(rule?.field || "邮件主题"),
      operator: String(rule?.operator || "包含"),
      value: String(rule?.value ?? "").trim(),
    }))
    .filter((rule: EmailTriggerRule) => allowedFields.has(rule.field) && allowedOperators.has(rule.operator))
    .slice(0, 20);
}

function normalizeEmailPriority(value: any) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function emailRuleSummary(config: Record<string, any>) {
  const rules = Array.isArray(config.rules) ? config.rules : [];
  if (rules.length === 0) return "收到新邮件即触发";

  const first = rules[0] || {};
  const firstText = `${first.field || "邮件"}${first.operator || "包含"}${first.value ? `“${first.value}”` : ""}`;
  if (rules.length === 1) return firstText;
  return `${firstText} 等 ${rules.length} 条`;
}

export async function createAutomation(userId: number, input: any) {
  await ensureAutomationTables();
  const tenantId = await getUserTenantId(userId);

  const appId = Number(input.appId ?? input.app_id);
  if (!Number.isInteger(appId) || appId <= 0) throw new Error("INVALID_APP_ID");

  const agentName = await resolveAppName(appId);
  if (!agentName) throw new Error("APP_NOT_FOUND");

  const name = String(input.name || "").trim();
  if (!name) throw new Error("NAME_REQUIRED");

  const task = String(input.task ?? input.prompt ?? "").trim();
  if (!task) throw new Error("TASK_REQUIRED");

  const triggerType = String(input.trigger || "定时触发") as AutomationTriggerType;
  const strategy = String(input.strategy || "需要确认后执行") as AutomationStrategy;
  const status: AutomationStatus = input.status === "paused" ? "paused" : "running";

  const triggerConfig: Record<string, any> = {};
  let nextRunAt: Date | null = null;

  if (triggerType === "定时触发") {
    const schedule = normalizeScheduleConfig(
      {
        period: input.schedulePeriod ?? input.triggerConfig?.period,
        time: input.scheduleTime ?? input.triggerConfig?.time,
        timezone: input.scheduleTimezone ?? input.triggerConfig?.timezone,
        weekdays: input.scheduleWeekdays ?? input.triggerConfig?.weekdays,
        weekday: input.triggerConfig?.weekday,
        monthlyMode: input.scheduleMonthlyMode ?? input.triggerConfig?.monthlyMode,
        dayOfMonth: input.scheduleDayOfMonth ?? input.triggerConfig?.dayOfMonth,
        missingDayPolicy:
          input.scheduleMissingDayPolicy ?? input.triggerConfig?.missingDayPolicy,
        date: input.scheduleDate ?? input.triggerConfig?.date,
        runAt: input.triggerConfig?.runAt,
      },
      new Date(),
      { strict: true }
    );
    Object.assign(triggerConfig, schedule);
    nextRunAt = status === "running" ? computeNextRunAt(schedule) : null;
  } else if (triggerType === "邮件触发") {
    Object.assign(triggerConfig, {
      mailboxKey: String(input.mailboxKey ?? input.triggerConfig?.mailboxKey ?? "system"),
      mailboxLabel: String(input.mailboxLabel ?? input.triggerConfig?.mailboxLabel ?? "系统邮箱"),
      folder: String(input.mailFolder ?? input.triggerConfig?.folder ?? "INBOX"),
      ruleMode: (input.mailRuleMode ?? input.triggerConfig?.ruleMode) === "any" ? "any" : "all",
      rules: normalizeEmailRules(input.mailRules ?? input.triggerConfig?.rules),
      priority: normalizeEmailPriority(input.mailPriority ?? input.triggerConfig?.priority),
    });
    nextRunAt = null;
  } else if (triggerType === "自动化完成触发") {
    triggerConfig.upstreamAutomationId =
      input.upstreamAutomationId ?? input.triggerConfig?.upstreamAutomationId ?? null;
    triggerConfig.upstreamCondition =
      input.upstreamCondition ?? input.triggerConfig?.upstreamCondition ?? "执行成功";
    triggerConfig.passPreviousResult =
      input.passPreviousResult ?? input.triggerConfig?.passPreviousResult ?? true;
  }

  const resultConfig = {
    resultEmail: input.resultEmail || null,
    resultEmailIncludeAttachments: Boolean(input.resultEmailIncludeAttachments),
    callbackUrl: input.callbackUrl || null,
    callbackTiming: input.callbackTiming || "任务结束后（推荐）",
    callbackAuth: input.callbackAuth || "无需验证",
  };

  const result = await pool.query(
    `INSERT INTO automation_tasks (
      tenant_id, created_by_user_id, name, app_id, agent_name, task,
      trigger_type, trigger_config, strategy, status, result_config, next_run_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12)
    RETURNING *`,
    [
      tenantId,
      userId,
      name,
      appId,
      agentName,
      task,
      triggerType,
      JSON.stringify(triggerConfig),
      strategy,
      status,
      JSON.stringify(resultConfig),
      nextRunAt,
    ]
  );

  return result.rows[0];
}

export async function listAutomations(userId: number) {
  await ensureAutomationTables();
  const result = await pool.query(
    `SELECT * FROM automation_tasks
     WHERE created_by_user_id = $1
     ORDER BY created_at DESC, id DESC`,
    [userId]
  );
  return result.rows;
}

export async function getAutomation(userId: number, id: number) {
  await ensureAutomationTables();
  const result = await pool.query(
    `SELECT * FROM automation_tasks
     WHERE id = $1 AND created_by_user_id = $2 LIMIT 1`,
    [id, userId]
  );
  return result.rows[0] || null;
}

export async function updateAutomation(userId: number, id: number, input: any) {
  const current = await getAutomation(userId, id);
  if (!current) return null;

  const appId = Number(input.appId ?? input.app_id ?? current.app_id);
  const agentName = await resolveAppName(appId);
  if (!agentName) throw new Error("APP_NOT_FOUND");

  const name = String(input.name ?? current.name).trim();
  const task = String(input.task ?? input.prompt ?? current.task).trim();
  if (!name) throw new Error("NAME_REQUIRED");
  if (!task) throw new Error("TASK_REQUIRED");

  const triggerType = String(input.trigger ?? current.trigger_type) as AutomationTriggerType;
  const strategy = String(input.strategy ?? current.strategy) as AutomationStrategy;
  const status: AutomationStatus =
    input.status === "paused" || (current.status === "paused" && input.status == null)
      ? "paused"
      : "running";

  let triggerConfig: Record<string, any> = current.trigger_config || {};
  let nextRunAt: Date | null = current.next_run_at ? new Date(current.next_run_at) : null;

  if (triggerType === "定时触发") {
    const scheduleFieldsTouched =
      current.trigger_type !== "定时触发" ||
      input.schedulePeriod !== undefined ||
      input.scheduleTime !== undefined ||
      input.scheduleTimezone !== undefined ||
      input.scheduleWeekdays !== undefined ||
      input.scheduleMonthlyMode !== undefined ||
      input.scheduleDayOfMonth !== undefined ||
      input.scheduleMissingDayPolicy !== undefined ||
      input.scheduleDate !== undefined ||
      input.triggerConfig !== undefined;

    const schedule = normalizeScheduleConfig(
      {
        period: input.schedulePeriod ?? input.triggerConfig?.period ?? triggerConfig.period,
        time: input.scheduleTime ?? input.triggerConfig?.time ?? triggerConfig.time,
        timezone:
          input.scheduleTimezone ?? input.triggerConfig?.timezone ?? triggerConfig.timezone,
        weekdays:
          input.scheduleWeekdays ??
          input.triggerConfig?.weekdays ??
          triggerConfig.weekdays,
        weekday: input.triggerConfig?.weekday ?? triggerConfig.weekday,
        monthlyMode:
          input.scheduleMonthlyMode ??
          input.triggerConfig?.monthlyMode ??
          triggerConfig.monthlyMode,
        dayOfMonth:
          input.scheduleDayOfMonth ??
          input.triggerConfig?.dayOfMonth ??
          triggerConfig.dayOfMonth,
        missingDayPolicy:
          input.scheduleMissingDayPolicy ??
          input.triggerConfig?.missingDayPolicy ??
          triggerConfig.missingDayPolicy,
        date:
          input.scheduleDate ??
          input.triggerConfig?.date ??
          triggerConfig.date,
        runAt: input.triggerConfig?.runAt ?? triggerConfig.runAt,
      },
      new Date(),
      { strict: scheduleFieldsTouched }
    );

    if (status === "running" && schedule.period === "仅一次") {
      const next = computeNextRunAt(schedule);
      if (!next) scheduleError("SCHEDULE_ONCE_EXPIRED");
      nextRunAt = next;
    } else {
      nextRunAt = status === "running" ? computeNextRunAt(schedule) : null;
    }
    triggerConfig = schedule;
  } else if (triggerType === "邮件触发") {
    triggerConfig = {
      mailboxKey: String(input.mailboxKey ?? input.triggerConfig?.mailboxKey ?? triggerConfig.mailboxKey ?? "system"),
      mailboxLabel: String(input.mailboxLabel ?? input.triggerConfig?.mailboxLabel ?? triggerConfig.mailboxLabel ?? "系统邮箱"),
      folder: String(input.mailFolder ?? input.triggerConfig?.folder ?? triggerConfig.folder ?? "INBOX"),
      ruleMode: (input.mailRuleMode ?? input.triggerConfig?.ruleMode ?? triggerConfig.ruleMode) === "any" ? "any" : "all",
      rules: normalizeEmailRules(input.mailRules ?? input.triggerConfig?.rules ?? triggerConfig.rules),
      priority: normalizeEmailPriority(input.mailPriority ?? input.triggerConfig?.priority ?? triggerConfig.priority),
    };
    nextRunAt = null;
  } else if (triggerType === "自动化完成触发") {
    triggerConfig = {
      upstreamAutomationId:
        input.upstreamAutomationId ??
        input.triggerConfig?.upstreamAutomationId ??
        triggerConfig.upstreamAutomationId ??
        null,
      upstreamCondition:
        input.upstreamCondition ??
        input.triggerConfig?.upstreamCondition ??
        triggerConfig.upstreamCondition ??
        "执行成功",
      passPreviousResult:
        input.passPreviousResult ??
        input.triggerConfig?.passPreviousResult ??
        triggerConfig.passPreviousResult ??
        true,
    };
    nextRunAt = null;
  } else {
    triggerConfig = {};
    nextRunAt = null;
  }

  const existingResultConfig = current.result_config || {};
  const resultConfig = {
    resultEmail:
      input.resultEmail !== undefined
        ? input.resultEmail || null
        : existingResultConfig.resultEmail || null,
    resultEmailIncludeAttachments:
      input.resultEmailIncludeAttachments !== undefined
        ? Boolean(input.resultEmailIncludeAttachments)
        : Boolean(existingResultConfig.resultEmailIncludeAttachments),
    callbackUrl:
      input.callbackUrl !== undefined
        ? input.callbackUrl || null
        : existingResultConfig.callbackUrl || null,
    callbackTiming:
      input.callbackTiming ?? existingResultConfig.callbackTiming ?? "任务结束后（推荐）",
    callbackAuth: input.callbackAuth ?? existingResultConfig.callbackAuth ?? "无需验证",
  };

  const result = await pool.query(
    `UPDATE automation_tasks SET
      name=$1, app_id=$2, agent_name=$3, task=$4, trigger_type=$5,
      trigger_config=$6::jsonb, strategy=$7, status=$8,
      result_config=$9::jsonb, next_run_at=$10, updated_at=NOW()
     WHERE id=$11 AND created_by_user_id=$12
     RETURNING *`,
    [
      name,
      appId,
      agentName,
      task,
      triggerType,
      JSON.stringify(triggerConfig),
      strategy,
      status,
      JSON.stringify(resultConfig),
      nextRunAt,
      id,
      userId,
    ]
  );

  return result.rows[0] || null;
}

export async function deleteAutomation(userId: number, id: number) {
  await ensureAutomationTables();

  const dependentResult = await pool.query(
    `SELECT id, name FROM automation_tasks
     WHERE created_by_user_id=$1
       AND trigger_type='自动化完成触发'
       AND NULLIF(trigger_config->>'upstreamAutomationId','')::INTEGER=$2
     ORDER BY id`,
    [userId, id]
  );

  if (dependentResult.rows.length > 0) {
    return { deleted: false, dependents: dependentResult.rows };
  }

  const result = await pool.query(
    `DELETE FROM automation_tasks
     WHERE id=$1 AND created_by_user_id=$2
     RETURNING id`,
    [id, userId]
  );

  return { deleted: result.rows.length > 0, dependents: [] };
}

async function insertRunRow(
  queryable: { query: (text: string, values?: any[]) => Promise<any> },
  task: any,
  status: "running" | "pending",
  triggerContext: Record<string, any> = {}
) {
  const needsReview = task.strategy === "需要确认后执行";
  const result = await queryable.query(
    `INSERT INTO automation_runs (
      automation_id, tenant_id, created_by_user_id, automation_name,
      app_id, agent_name, trigger_type, trigger_context,
      task_snapshot, strategy_snapshot, result_config_snapshot,
      status, review_status, processing_started_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12,$13,NOW())
    RETURNING *`,
    [
      task.id,
      task.tenant_id,
      task.created_by_user_id,
      task.name,
      task.app_id,
      task.agent_name,
      task.trigger_type,
      JSON.stringify(triggerContext),
      task.task || "",
      task.strategy || "",
      JSON.stringify(task.result_config || {}),
      status,
      needsReview ? "not_started" : "not_required",
    ]
  );
  return result.rows[0] || null;
}

export async function createRun(
  task: any,
  status: "running" | "pending",
  triggerContext: Record<string, any> = {}
) {
  await ensureAutomationTables();
  return insertRunRow(pool, task, status, triggerContext);
}

/**
 * 原子认领一个到期的定时任务：
 * 1. 在同一数据库事务里锁住任务；
 * 2. 创建本次 Run；
 * 3. 推进 next_run_at（仅一次任务则暂停）；
 * 4. 提交后再由 Scheduler 执行 AI。
 *
 * 这样可以避免“next_run_at 已推进但 Run 尚未创建”时进程异常导致的丢任务窗口。
 */
export async function claimDueScheduledRun(automationId: number) {
  await ensureAutomationTables();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const taskResult = await client.query(
      `SELECT * FROM automation_tasks
       WHERE id=$1
         AND status='running'
         AND trigger_type='定时触发'
         AND next_run_at IS NOT NULL
         AND next_run_at <= NOW()
       FOR UPDATE`,
      [automationId]
    );

    const task = taskResult.rows[0];
    if (!task) {
      await client.query("COMMIT");
      return null;
    }

    const scheduledFor = new Date(task.next_run_at);
    let nextRunAt: Date | null = null;
    let nextStatus: AutomationStatus = task.status;

    if (task.trigger_config?.period === "仅一次") {
      nextStatus = "paused";
    } else {
      // 服务短暂中断后只补执行当前这一条过期计划，不逐条追赶历史周期。
      // 下一次执行时间直接从“当前时间”和“本次计划时间之后”两者较晚者开始计算。
      const nextAfter = new Date(Math.max(Date.now(), scheduledFor.getTime() + 1000));
      nextRunAt = computeNextRunAt(task.trigger_config || {}, nextAfter);
      if (!nextRunAt) {
        await client.query("ROLLBACK");
        scheduleError("SCHEDULE_NO_NEXT_RUN");
      }
    }

    const triggerContext = {
      source: "server-cron",
      scheduledFor: scheduledFor.toISOString(),
      firedAt: new Date().toISOString(),
      schedule: task.trigger_config || {},
    };

    const run = await insertRunRow(client, task, "running", triggerContext);
    if (!run) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `UPDATE automation_tasks SET
         next_run_at=$1,
         status=$2,
         updated_at=NOW()
       WHERE id=$3`,
      [nextRunAt, nextStatus, task.id]
    );

    await client.query("COMMIT");

    return {
      task,
      run,
      scheduledFor: scheduledFor.toISOString(),
      nextRunAt,
      nextStatus,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback error
    }
    throw error;
  } finally {
    client.release();
  }
}

async function insertReviewHistory(
  client: any,
  params: {
    runId: number;
    eventType: string;
    aiVersion?: number | null;
    content?: string | null;
    note?: string | null;
    actorUserId?: number | null;
  }
) {
  await client.query(
    `INSERT INTO automation_run_review_history (
      run_id, event_type, ai_version, content, note, actor_user_id
    ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      params.runId,
      params.eventType,
      params.aiVersion ?? null,
      params.content ?? null,
      params.note ?? null,
      params.actorUserId ?? null,
    ]
  );
}

type RunActionSpec = {
  key: string;
  type: "email" | "result_url";
  config: Record<string, any>;
};

function successActionSpecsForRun(run: any): RunActionSpec[] {
  const config = run?.result_config_snapshot || {};
  const specs: RunActionSpec[] = [];

  const resultEmail =
    typeof config.resultEmail === "string" ? config.resultEmail.trim() : "";
  if (resultEmail) {
    specs.push({
      key: "result_email",
      type: "email",
      config: {
        to: resultEmail,
        includeAttachments: config.resultEmailIncludeAttachments === true,
      },
    });
  }

  const callbackUrl =
    typeof config.callbackUrl === "string" ? config.callbackUrl.trim() : "";
  const callbackTiming =
    typeof config.callbackTiming === "string"
      ? config.callbackTiming
      : "任务结束后（推荐）";

  if (callbackUrl && callbackTiming !== "仅任务失败后") {
    specs.push({
      key: "result_url",
      type: "result_url",
      config: {
        url: callbackUrl,
        auth: config.callbackAuth || "无需验证",
        timing: callbackTiming,
      },
    });
  }

  return specs;
}

async function insertRunActionSpecs(client: any, runId: number, specs: RunActionSpec[]) {
  for (const spec of specs) {
    await client.query(
      `INSERT INTO automation_run_actions (
        run_id, action_key, action_type, status, config
      ) VALUES ($1,$2,$3,'pending',$4::jsonb)
      ON CONFLICT (run_id, action_key) DO NOTHING`,
      [runId, spec.key, spec.type, JSON.stringify(spec.config)]
    );
  }
}

export async function listRunActions(userId: number, runId: number) {
  await ensureAutomationTables();

  const result = await pool.query(
    `SELECT action.*
     FROM automation_run_actions AS action
     INNER JOIN automation_runs AS run ON run.id = action.run_id
     WHERE action.run_id=$1 AND run.created_by_user_id=$2
     ORDER BY action.id ASC`,
    [runId, userId]
  );

  return result.rows;
}

export function runActionRowToApi(row: any) {
  return {
    id: row.id,
    runId: row.run_id,
    key: row.action_key,
    type: row.action_type,
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    config: row.config || {},
    result: row.result || {},
    error: row.error || undefined,
    startedAt: row.started_at || undefined,
    finishedAt: row.finished_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export async function prepareAutomaticRunActions(
  userId: number,
  runId: number,
  resultText: string
) {
  await ensureAutomationTables();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query(
      `SELECT * FROM automation_runs
       WHERE id=$1 AND created_by_user_id=$2
       FOR UPDATE`,
      [runId, userId]
    );

    const run = locked.rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");
    if (run.status !== "running") throw new Error("RUN_STATE_CONFLICT");

    const content = resultText || "任务已完成，未返回文本结果";
    const specs = successActionSpecsForRun(run);
    await insertRunActionSpecs(client, runId, specs);

    const hasActions = specs.length > 0;
    const updated = await client.query(
      `UPDATE automation_runs SET
        status=$1::varchar,
        result=$2,
        ai_result=$2,
        review_content=$2,
        final_result=$2,
        review_status='not_required',
        action_status=$3,
        error=NULL,
        duration_ms=COALESCE(duration_ms, 0) + CASE
          WHEN processing_started_at IS NOT NULL THEN GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - processing_started_at)) * 1000)::INTEGER
          )
          ELSE 0
        END,
        processing_started_at=NULL,
        finished_at=CASE WHEN $1::varchar='success' THEN NOW() ELSE NULL END,
        updated_at=NOW()
       WHERE id=$4
       RETURNING *`,
      [hasActions ? "action_running" : "success", content, hasActions ? "pending" : "not_required", runId]
    );

    await client.query("COMMIT");
    return updated.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimNextRunAction(userId: number, runId: number) {
  await ensureAutomationTables();

  const result = await pool.query(
    `UPDATE automation_run_actions AS action SET
      status='running',
      attempt_count=attempt_count + 1,
      started_at=NOW(),
      finished_at=NULL,
      error=NULL,
      updated_at=NOW()
     WHERE action.id = (
       SELECT candidate.id
       FROM automation_run_actions AS candidate
       INNER JOIN automation_runs AS run ON run.id = candidate.run_id
       WHERE candidate.run_id=$1
         AND run.created_by_user_id=$2
         AND run.status='action_running'
         AND candidate.status='pending'
       ORDER BY candidate.id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING action.*`,
    [runId, userId]
  );

  return result.rows[0] || null;
}

export async function completeRunAction(
  userId: number,
  actionId: number,
  status: "success" | "failed",
  resultData?: Record<string, any>,
  errorText?: string
) {
  await ensureAutomationTables();

  const result = await pool.query(
    `UPDATE automation_run_actions AS action SET
      status=$1,
      result=$2::jsonb,
      error=$3,
      finished_at=NOW(),
      updated_at=NOW()
     FROM automation_runs AS run
     WHERE action.id=$4
       AND action.run_id=run.id
       AND run.created_by_user_id=$5
       AND action.status='running'
     RETURNING action.*`,
    [status, JSON.stringify(resultData || {}), errorText || null, actionId, userId]
  );

  return result.rows[0] || null;
}

export async function finalizeRunActions(userId: number, runId: number) {
  await ensureAutomationTables();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query(
      `SELECT * FROM automation_runs
       WHERE id=$1 AND created_by_user_id=$2
       FOR UPDATE`,
      [runId, userId]
    );

    const run = locked.rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");
    if (run.status !== "action_running") {
      await client.query("COMMIT");
      return run;
    }

    const countsResult = await client.query(
      `SELECT
        COUNT(*) FILTER (WHERE status='pending')::INTEGER AS pending_count,
        COUNT(*) FILTER (WHERE status='running')::INTEGER AS running_count,
        COUNT(*) FILTER (WHERE status='failed')::INTEGER AS failed_count,
        STRING_AGG(error, '；' ORDER BY id) FILTER (WHERE status='failed' AND error IS NOT NULL) AS errors
       FROM automation_run_actions
       WHERE run_id=$1`,
      [runId]
    );

    const counts = countsResult.rows[0] || {};
    if (Number(counts.pending_count || 0) > 0 || Number(counts.running_count || 0) > 0) {
      await client.query("COMMIT");
      return run;
    }

    const failed = Number(counts.failed_count || 0) > 0;
    const errorText = failed
      ? `后续操作执行失败${counts.errors ? `：${counts.errors}` : ""}`
      : null;

    const updated = await client.query(
      `UPDATE automation_runs SET
        status=$1,
        action_status=$2,
        error=$3,
        finished_at=NOW(),
        updated_at=NOW()
       WHERE id=$4
       RETURNING *`,
      [failed ? "failed" : "success", failed ? "failed" : "success", errorText, runId]
    );

    await client.query("COMMIT");
    return updated.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function prepareFailedRunActionsForRetry(
  userId: number,
  runId: number
) {
  await ensureAutomationTables();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query(
      `SELECT * FROM automation_runs
       WHERE id=$1 AND created_by_user_id=$2
       FOR UPDATE`,
      [runId, userId]
    );

    const run = locked.rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");

    // 失败重试只允许发生在“后续操作已经执行失败”的 Run 上。
    // final_result / result 在这里保持不变，因此不会重新运行 AI 或重新进入审核。
    if (run.status !== "failed" || run.action_status !== "failed") {
      throw new Error("RUN_STATE_CONFLICT");
    }

    const failedResult = await client.query(
      `SELECT COUNT(*)::INTEGER AS failed_count
       FROM automation_run_actions
       WHERE run_id=$1 AND status='failed'`,
      [runId]
    );

    if (Number(failedResult.rows[0]?.failed_count || 0) <= 0) {
      throw new Error("NO_FAILED_ACTIONS");
    }

    // 只把失败 Action 放回等待队列。已经成功的 Action 保持 success，
    // executeRunActions 后续只会 claim pending，因此不会重复发送成功操作。
    await client.query(
      `UPDATE automation_run_actions SET
        status='pending',
        error=NULL,
        started_at=NULL,
        finished_at=NULL,
        updated_at=NOW()
       WHERE run_id=$1 AND status='failed'`,
      [runId]
    );

    const updated = await client.query(
      `UPDATE automation_runs SET
        status='action_running',
        action_status='pending',
        error=NULL,
        finished_at=NULL,
        updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [runId]
    );

    await client.query("COMMIT");
    return updated.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveRunExecutionArtifacts(
  runId: number,
  attachments: Array<Record<string, any>> = []
) {
  await ensureAutomationTables();

  const safeAttachments = (Array.isArray(attachments) ? attachments : [])
    .map((item) => ({
      filename: String(item?.filename || "attachment").trim() || "attachment",
      object_key: String(item?.object_key || "").trim(),
      ...(item?.content_type ? { content_type: String(item.content_type) } : {}),
      ...(Number.isFinite(Number(item?.size)) && Number(item.size) >= 0
        ? { size: Number(item.size) }
        : {}),
    }))
    .filter((item) => item.object_key)
    .slice(0, 10);

  const result = await pool.query(
    `UPDATE automation_runs SET
       result_attachments=$1::jsonb,
       updated_at=NOW()
     WHERE id=$2
     RETURNING *`,
    [JSON.stringify(safeAttachments), runId]
  );
  return result.rows[0] || null;
}

export async function markRunPendingReview(
  runId: number,
  resultText: string,
  actorUserId?: number,
  note?: string
) {
  await ensureAutomationTables();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query(
      `SELECT * FROM automation_runs
       WHERE id=$1
       FOR UPDATE`,
      [runId]
    );

    const run = locked.rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");
    if (!["running", "regenerating"].includes(String(run.status))) {
      throw new Error("RUN_STATE_CONFLICT");
    }

    const nextVersion = Number(run.ai_version || 0) + 1;
    const content = resultText || "任务已完成，未返回文本结果";

    const updated = await client.query(
      `UPDATE automation_runs SET
        status='pending',
        result=$1,
        ai_result=$1,
        review_content=$1,
        ai_version=$2,
        review_status='pending',
        reviewer_user_id=NULL,
        reviewed_at=NULL,
        rejection_reason=NULL,
        action_status='not_started',
        error=NULL,
        finished_at=NULL,
        duration_ms=COALESCE(duration_ms, 0) + CASE
          WHEN processing_started_at IS NOT NULL THEN GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - processing_started_at)) * 1000)::INTEGER
          )
          ELSE 0
        END,
        processing_started_at=NULL,
        updated_at=NOW()
       WHERE id=$3
       RETURNING *`,
      [content, nextVersion, runId]
    );

    await insertReviewHistory(client, {
      runId,
      eventType: "ai_generated",
      aiVersion: nextVersion,
      content,
      note: note || (nextVersion === 1 ? "initial" : "regenerated"),
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return updated.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function finishRun(
  runId: number,
  status: "success" | "failed" | "timed_out",
  resultText?: string,
  errorText?: string
) {
  await ensureAutomationTables();

  const result = await pool.query(
    `UPDATE automation_runs SET
      status=$1::varchar,
      result=$2,
      ai_result=CASE WHEN $1::varchar='success' AND $2 IS NOT NULL THEN COALESCE(ai_result, $2) ELSE ai_result END,
      final_result=CASE
        WHEN $1::varchar='success' AND review_status='not_required' THEN $2
        ELSE final_result
      END,
      error=$3,
      finished_at=NOW(),
      duration_ms=COALESCE(duration_ms, 0) + CASE
        WHEN processing_started_at IS NOT NULL THEN GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (NOW() - processing_started_at)) * 1000)::INTEGER
        )
        ELSE 0
      END,
      processing_started_at=NULL,
      updated_at=NOW()
     WHERE id=$4
     RETURNING *`,
    [status, resultText || null, errorText || null, runId]
  );
  return result.rows[0] || null;
}

export async function getRunForUser(userId: number, runId: number) {
  await ensureAutomationTables();

  const result = await pool.query(
    `SELECT * FROM automation_runs
     WHERE id=$1 AND created_by_user_id=$2
     LIMIT 1`,
    [runId, userId]
  );

  return result.rows[0] || null;
}

export async function listRunReviewHistory(userId: number, runId: number) {
  await ensureAutomationTables();

  const result = await pool.query(
    `SELECT history.*
     FROM automation_run_review_history AS history
     INNER JOIN automation_runs AS run ON run.id = history.run_id
     WHERE history.run_id=$1 AND run.created_by_user_id=$2
     ORDER BY history.created_at ASC, history.id ASC`,
    [runId, userId]
  );

  return result.rows;
}

export async function saveRunReviewDraft(
  userId: number,
  runId: number,
  content: string
) {
  await ensureAutomationTables();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query(
      `SELECT * FROM automation_runs
       WHERE id=$1 AND created_by_user_id=$2
       FOR UPDATE`,
      [runId, userId]
    );

    const run = locked.rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");
    if (run.status !== "pending") throw new Error("RUN_STATE_CONFLICT");

    const draft = content.trim();
    if (!draft) throw new Error("EMPTY_REVIEW_CONTENT");

    const updated = await client.query(
      `UPDATE automation_runs SET
        result=$1,
        review_content=$1,
        updated_at=NOW()
       WHERE id=$2
       RETURNING *`,
      [draft, runId]
    );

    await insertReviewHistory(client, {
      runId,
      eventType: "human_edited",
      aiVersion: Number(run.ai_version || 0),
      content: draft,
      actorUserId: userId,
    });

    await client.query("COMMIT");
    return updated.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function beginRunRegeneration(
  userId: number,
  runId: number,
  advice: string
) {
  await ensureAutomationTables();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query(
      `SELECT * FROM automation_runs
       WHERE id=$1 AND created_by_user_id=$2
       FOR UPDATE`,
      [runId, userId]
    );

    const run = locked.rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");
    if (run.status !== "pending") throw new Error("RUN_STATE_CONFLICT");

    const trimmedAdvice = advice.trim();
    if (!trimmedAdvice) throw new Error("EMPTY_REGENERATION_ADVICE");

    const updated = await client.query(
      `UPDATE automation_runs SET
        status='regenerating',
        processing_started_at=NOW(),
        error=NULL,
        updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [runId]
    );

    await insertReviewHistory(client, {
      runId,
      eventType: "regeneration_requested",
      aiVersion: Number(run.ai_version || 0),
      content: run.review_content || run.result || null,
      note: trimmedAdvice,
      actorUserId: userId,
    });

    await client.query("COMMIT");
    return updated.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function restoreRunAfterRegenerationFailure(
  userId: number,
  runId: number,
  errorText: string
) {
  await ensureAutomationTables();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query(
      `SELECT * FROM automation_runs
       WHERE id=$1 AND created_by_user_id=$2
       FOR UPDATE`,
      [runId, userId]
    );

    const run = locked.rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");

    if (run.status !== "regenerating") {
      await client.query("COMMIT");
      return run;
    }

    const updated = await client.query(
      `UPDATE automation_runs SET
        status='pending',
        review_status='pending',
        duration_ms=COALESCE(duration_ms, 0) + CASE
          WHEN processing_started_at IS NOT NULL THEN GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - processing_started_at)) * 1000)::INTEGER
          )
          ELSE 0
        END,
        processing_started_at=NULL,
        error=$1,
        updated_at=NOW()
       WHERE id=$2
       RETURNING *`,
      [errorText || "重新生成失败", runId]
    );

    await insertReviewHistory(client, {
      runId,
      eventType: "regeneration_failed",
      aiVersion: Number(run.ai_version || 0),
      content: run.review_content || run.result || null,
      note: errorText || "重新生成失败",
      actorUserId: userId,
    });

    await client.query("COMMIT");
    return updated.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function approveRunReview(
  userId: number,
  runId: number,
  content?: string
) {
  await ensureAutomationTables();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query(
      `SELECT * FROM automation_runs
       WHERE id=$1 AND created_by_user_id=$2
       FOR UPDATE`,
      [runId, userId]
    );

    const run = locked.rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");
    if (run.status !== "pending") throw new Error("RUN_STATE_CONFLICT");

    const finalContent = (content ?? run.review_content ?? run.result ?? "").trim();
    if (!finalContent) throw new Error("EMPTY_REVIEW_CONTENT");

    const specs = successActionSpecsForRun(run);
    await insertRunActionSpecs(client, runId, specs);
    const hasActions = specs.length > 0;

    const updated = await client.query(
      `UPDATE automation_runs SET
        status=$1::varchar,
        result=$2,
        review_content=$2,
        final_result=$2,
        review_status='approved',
        action_status=$3,
        reviewer_user_id=$4,
        reviewed_at=NOW(),
        rejection_reason=NULL,
        error=NULL,
        finished_at=CASE WHEN $1::varchar='success' THEN NOW() ELSE NULL END,
        processing_started_at=NULL,
        updated_at=NOW()
       WHERE id=$5
       RETURNING *`,
      [hasActions ? "action_running" : "success", finalContent, hasActions ? "pending" : "not_required", userId, runId]
    );

    await insertReviewHistory(client, {
      runId,
      eventType: "approved",
      aiVersion: Number(run.ai_version || 0),
      content: finalContent,
      actorUserId: userId,
    });

    await client.query("COMMIT");
    return updated.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rejectRunReview(
  userId: number,
  runId: number,
  reason?: string
) {
  await ensureAutomationTables();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query(
      `SELECT * FROM automation_runs
       WHERE id=$1 AND created_by_user_id=$2
       FOR UPDATE`,
      [runId, userId]
    );

    const run = locked.rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");
    if (run.status !== "pending") throw new Error("RUN_STATE_CONFLICT");

    const rejectionReason = reason?.trim() || null;

    const updated = await client.query(
      `UPDATE automation_runs SET
        status='rejected',
        review_status='rejected',
        reviewer_user_id=$1,
        reviewed_at=NOW(),
        rejection_reason=$2,
        action_status='not_required',
        error=NULL,
        finished_at=NOW(),
        processing_started_at=NULL,
        updated_at=NOW()
       WHERE id=$3
       RETURNING *`,
      [userId, rejectionReason, runId]
    );

    await insertReviewHistory(client, {
      runId,
      eventType: "rejected",
      aiVersion: Number(run.ai_version || 0),
      content: run.review_content || run.result || null,
      note: rejectionReason,
      actorUserId: userId,
    });

    await client.query("COMMIT");
    return updated.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimAutomationEmailMessage(
  userId: number,
  mailboxKey: string,
  messageKey: string,
  automationId: number
) {
  await ensureAutomationTables();

  const safeMailboxKey = String(mailboxKey || "system").trim() || "system";
  const safeMessageKey = String(messageKey || "").trim();
  if (!safeMessageKey) throw new Error("EMAIL_MESSAGE_KEY_REQUIRED");

  const result = await pool.query(
    `INSERT INTO automation_email_processed_messages (
      created_by_user_id, mailbox_key, message_key, automation_id
    ) VALUES ($1,$2,$3,$4)
    ON CONFLICT (created_by_user_id, mailbox_key, message_key) DO NOTHING
    RETURNING id`,
    [userId, safeMailboxKey, safeMessageKey.slice(0, 500), automationId]
  );

  return result.rows.length > 0;
}

export type AutomationEmailRuleOutcome =
  | "triggered"
  | "suppressed_by_priority"
  | "not_matched"
  | "duplicate";

export type AutomationEmailRuleEvaluationInput = {
  userId: number;
  mailboxKey: string;
  messageKey: string;
  messageUid?: number;
  automationId: number;
  outcome: AutomationEmailRuleOutcome;
  winnerAutomationId?: number | null;
  matchedRule?: string;
  priority?: number;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
};

export async function recordAutomationEmailRuleEvaluations(
  evaluations: AutomationEmailRuleEvaluationInput[]
) {
  await ensureAutomationTables();
  const safe = evaluations
    .filter((item) => Number.isInteger(Number(item.userId)) && Number.isInteger(Number(item.automationId)))
    .map((item) => ({
      ...item,
      mailboxKey: String(item.mailboxKey || "system").trim() || "system",
      messageKey: String(item.messageKey || "").trim().slice(0, 500),
    }))
    .filter((item) => item.messageKey);

  if (safe.length === 0) return;

  const values: string[] = [];
  const params: any[] = [];
  for (const item of safe) {
    const start = params.length;
    params.push(
      item.userId,
      item.mailboxKey,
      item.messageKey,
      Number.isFinite(Number(item.messageUid)) ? Number(item.messageUid) : null,
      item.automationId,
      item.outcome,
      item.winnerAutomationId ?? null,
      item.matchedRule || null,
      Number.isFinite(Number(item.priority)) ? Number(item.priority) : null,
      item.from || null,
      item.to || null,
      item.subject || null,
      item.date || null,
    );
    const indexes = Array.from({ length: 13 }, (_, i) => `$${start + i + 1}`);
    values.push(`(${indexes.join(",")},NOW())`);
  }

  await pool.query(
    `INSERT INTO automation_email_rule_events (
       created_by_user_id, mailbox_key, message_key, message_uid,
       automation_id, outcome, winner_automation_id, matched_rule, priority,
       from_address, to_address, subject, message_date, created_at
     ) VALUES ${values.join(",")}
     ON CONFLICT (created_by_user_id, mailbox_key, message_key, automation_id) DO NOTHING`,
    params,
  );
}

export async function getAutomationEmailRoutingStats(userId: number, automationId: number) {
  await ensureAutomationTables();

  const statsResult = await pool.query(
    `SELECT
       COUNT(*)::int AS scanned,
       COUNT(*) FILTER (WHERE outcome <> 'not_matched')::int AS matched,
       COUNT(*) FILTER (WHERE outcome = 'triggered')::int AS triggered,
       COUNT(*) FILTER (WHERE outcome = 'suppressed_by_priority')::int AS suppressed,
       COUNT(*) FILTER (WHERE outcome = 'not_matched')::int AS not_matched,
       COUNT(*) FILTER (WHERE outcome = 'duplicate')::int AS duplicate
     FROM automation_email_rule_events
     WHERE created_by_user_id=$1 AND automation_id=$2`,
    [userId, automationId],
  );

  const recentResult = await pool.query(
    `SELECT
       id, mailbox_key, message_key, message_uid, automation_id, outcome,
       winner_automation_id, matched_rule, priority,
       from_address, to_address, subject, message_date, created_at
     FROM automation_email_rule_events
     WHERE created_by_user_id=$1 AND automation_id=$2
     ORDER BY created_at DESC, id DESC
     LIMIT 20`,
    [userId, automationId],
  );

  const row = statsResult.rows[0] || {};
  return {
    scanned: Number(row.scanned || 0),
    matched: Number(row.matched || 0),
    triggered: Number(row.triggered || 0),
    suppressed: Number(row.suppressed || 0),
    notMatched: Number(row.not_matched || 0),
    duplicate: Number(row.duplicate || 0),
    recent: recentResult.rows.map((item: any) => ({
      id: Number(item.id),
      mailboxKey: item.mailbox_key,
      messageKey: item.message_key,
      messageUid: item.message_uid == null ? undefined : Number(item.message_uid),
      automationId: Number(item.automation_id),
      outcome: item.outcome,
      winnerAutomationId:
        item.winner_automation_id == null ? undefined : Number(item.winner_automation_id),
      matchedRule: item.matched_rule || undefined,
      priority: item.priority == null ? undefined : Number(item.priority),
      from: item.from_address || undefined,
      to: item.to_address || undefined,
      subject: item.subject || undefined,
      date: item.message_date || undefined,
      createdAt: item.created_at,
    })),
  };
}

export type AutomationNotificationKind =
  | "pending_review"
  | "run_failed"
  | "run_timed_out"
  | "run_success"
  | "email_failed"
  | "result_url_failed";

export interface AutomationNotificationItem {
  eventKey: string;
  kind: AutomationNotificationKind;
  level: "strong" | "normal";
  title: string;
  message: string;
  automationId: number | null;
  runId: number;
  createdAt: string;
  read: boolean;
  readAt?: string;
}

async function getAutomationNotificationInitializedAt(userId: number) {
  await ensureAutomationTables();
  await pool.query(
    `INSERT INTO automation_notification_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const result = await pool.query(
    `SELECT initialized_at, success_enabled
     FROM automation_notification_preferences
     WHERE user_id=$1
     LIMIT 1`,
    [userId]
  );

  return {
    initializedAt: result.rows[0]?.initialized_at || new Date(),
    successEnabled: result.rows[0]?.success_enabled !== false,
  };
}

function notificationEventTime(row: any) {
  const value = row.event_time || row.finished_at || row.updated_at || row.created_at || row.started_at;
  return value ? new Date(value) : new Date();
}

function clipNotificationError(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export async function listAutomationNotifications(userId: number) {
  const { initializedAt, successEnabled } = await getAutomationNotificationInitializedAt(userId);

  const runResult = await pool.query(
    `SELECT id, automation_id, automation_name, status, action_status, ai_version,
            error, started_at, created_at, updated_at, finished_at,
            COALESCE(updated_at, finished_at, created_at, started_at) AS event_time
     FROM automation_runs
     WHERE created_by_user_id=$1
       AND (
         status='pending'
         OR (
           COALESCE(updated_at, finished_at, created_at, started_at) >= $2
           AND status IN ('failed', 'timed_out', 'success')
         )
       )
     ORDER BY COALESCE(updated_at, finished_at, created_at, started_at) DESC, id DESC
     LIMIT 160`,
    [userId, initializedAt]
  );

  const actionResult = await pool.query(
    `SELECT action.id, action.run_id, action.action_type, action.status,
            action.attempt_count, action.error, action.created_at, action.updated_at,
            action.finished_at, run.automation_id, run.automation_name,
            COALESCE(action.finished_at, action.updated_at, action.created_at) AS event_time
     FROM automation_run_actions AS action
     JOIN automation_runs AS run ON run.id=action.run_id
     WHERE run.created_by_user_id=$1
       AND action.status='failed'
       AND COALESCE(action.finished_at, action.updated_at, action.created_at) >= $2
     ORDER BY COALESCE(action.finished_at, action.updated_at, action.created_at) DESC, action.id DESC
     LIMIT 100`,
    [userId, initializedAt]
  );

  const items: AutomationNotificationItem[] = [];

  for (const row of runResult.rows) {
    const runId = Number(row.id);
    const automationId = row.automation_id ? Number(row.automation_id) : null;
    const name = String(row.automation_name || "自动化");
    const createdAt = notificationEventTime(row).toISOString();

    if (row.status === "pending") {
      const version = Math.max(1, Number(row.ai_version || 1));
      items.push({
        eventKey: `run:${runId}:pending:v${version}`,
        kind: "pending_review",
        level: "strong",
        title: `【待处理】${name}需要审核`,
        message: "AI 已生成结果，等待你审核后决定是否执行后续业务动作。",
        automationId,
        runId,
        createdAt,
        read: false,
      });
      continue;
    }

    if (row.status === "failed") {
      // 后续 Action 失败会生成更具体的邮件 / URL 失败提醒，避免重复提示。
      if (row.action_status === "failed") continue;
      const error = clipNotificationError(row.error);
      items.push({
        eventKey: `run:${runId}:failed:${new Date(createdAt).getTime()}`,
        kind: "run_failed",
        level: "strong",
        title: `【失败】${name}执行失败`,
        message: error ? `本次运行失败：${error}` : "本次自动化运行失败，请进入运行详情查看原因。",
        automationId,
        runId,
        createdAt,
        read: false,
      });
      continue;
    }

    if (row.status === "timed_out") {
      items.push({
        eventKey: `run:${runId}:timed_out`,
        kind: "run_timed_out",
        level: "strong",
        title: `【超时】${name}执行超时`,
        message: "本次自动化超过允许执行时间，请进入运行详情处理。",
        automationId,
        runId,
        createdAt,
        read: false,
      });
      continue;
    }

    if (row.status === "success" && successEnabled) {
      items.push({
        eventKey: `run:${runId}:success`,
        kind: "run_success",
        level: "normal",
        title: `【成功】${name}已执行完成`,
        message: "本次自动化已完成，可进入运行详情查看最终结果。",
        automationId,
        runId,
        createdAt,
        read: false,
      });
    }
  }

  for (const row of actionResult.rows) {
    const runId = Number(row.run_id);
    const automationId = row.automation_id ? Number(row.automation_id) : null;
    const name = String(row.automation_name || "自动化");
    const attempt = Math.max(1, Number(row.attempt_count || 1));
    const createdAt = notificationEventTime(row).toISOString();
    const error = clipNotificationError(row.error);
    const isEmail = row.action_type === "email";

    items.push({
      eventKey: `action:${Number(row.id)}:failed:attempt${attempt}`,
      kind: isEmail ? "email_failed" : "result_url_failed",
      level: "strong",
      title: isEmail ? `【失败】${name}结果邮件发送失败` : `【失败】${name}结果 URL 发送失败`,
      message: error
        ? `${isEmail ? "结果邮件" : "结果 URL"}发送失败：${error}`
        : `${isEmail ? "结果邮件" : "结果 URL"}发送失败，可进入运行详情重试失败操作。`,
      automationId,
      runId,
      createdAt,
      read: false,
    });
  }

  const stateResult = await pool.query(
    `SELECT event_key, read_at, dismissed_at
     FROM automation_notification_states
     WHERE user_id=$1`,
    [userId]
  );

  const stateMap = new Map<string, any>(stateResult.rows.map((row) => [String(row.event_key), row]));
  const merged = items
    .filter((item) => !stateMap.get(item.eventKey)?.dismissed_at)
    .map((item) => {
      const state = stateMap.get(item.eventKey);
      return {
        ...item,
        read: Boolean(state?.read_at),
        readAt: state?.read_at ? new Date(state.read_at).toISOString() : undefined,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 100);

  return {
    items: merged,
    unreadCount: merged.filter((item) => !item.read).length,
  };
}

export async function markAutomationNotificationsRead(userId: number, eventKeys: string[]) {
  await ensureAutomationTables();
  const keys = Array.from(
    new Set(
      (Array.isArray(eventKeys) ? eventKeys : [])
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0 && value.length <= 255)
    )
  ).slice(0, 100);

  if (keys.length === 0) return;

  for (const eventKey of keys) {
    await pool.query(
      `INSERT INTO automation_notification_states (user_id, event_key, read_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (user_id, event_key)
       DO UPDATE SET read_at=NOW(), updated_at=NOW()`,
      [userId, eventKey]
    );
  }
}

export async function listRuns(userId: number, automationId?: number) {
  await ensureAutomationTables();
  const params: any[] = [userId];
  let automationFilter = "";

  if (automationId) {
    params.push(automationId);
    automationFilter = `AND automation_id = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT * FROM automation_runs
     WHERE created_by_user_id=$1 ${automationFilter}
     ORDER BY created_at DESC, id DESC
     LIMIT 500`,
    params
  );
  return result.rows;
}

export function automationRowToApi(row: any) {
  const config = row.trigger_config || {};
  const resultConfig = row.result_config || {};

  let scheduleTimezone = "Asia/Shanghai";
  try {
    scheduleTimezone = cleanTimeZone(config.timezone);
  } catch {
    scheduleTimezone = "Asia/Shanghai";
  }

  const scheduleWeekdays = normalizeWeekdays(config.weekdays, config.weekday);
  const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const scheduleDate =
    config.date ||
    (config.runAt
      ? (() => {
          const parsed = new Date(config.runAt);
          return Number.isNaN(parsed.getTime())
            ? undefined
            : formatCalendarDateInZone(parsed, scheduleTimezone);
        })()
      : undefined);

  let scheduleSummary = `${config.period || "每天"} ${config.time || "09:00"}`;
  if (config.period === "每周" && scheduleWeekdays.length > 0) {
    scheduleSummary = `每周 ${scheduleWeekdays.map((day) => weekdayNames[day]).join("、")} ${config.time || "09:00"}`;
  } else if (config.period === "每月") {
    if (config.monthlyMode === "last_day") {
      scheduleSummary = `每月最后一天 ${config.time || "09:00"}`;
    } else if (Number(config.dayOfMonth)) {
      const missingText =
        Number(config.dayOfMonth) >= 29
          ? config.missingDayPolicy === "skip"
            ? " · 无该日期时跳过"
            : " · 无该日期时按月末执行"
          : "";
      scheduleSummary = `每月 ${Number(config.dayOfMonth)}日 ${config.time || "09:00"}${missingText}`;
    }
  } else if (config.period === "仅一次") {
    scheduleSummary = `仅一次 ${scheduleDate || "未指定日期"} ${config.time || "09:00"}`;
  }

  const triggerDetail =
    row.trigger_type === "定时触发"
      ? `${scheduleSummary} · ${scheduleTimezone}`
      : row.trigger_type === "邮件触发"
        ? `${config.mailboxLabel || "系统邮箱"} · ${emailRuleSummary(config)} · 优先级 ${normalizeEmailPriority(config.priority)}`
        : row.trigger_type === "Webhook / API"
          ? "由外部系统通过 Webhook / API 触发"
          : "上游自动化完成后触发";

  const statusText =
    row.status === "paused" ? "已暂停" : row.status === "error" ? "异常" : "运行中";

  const lastRunDisplay = row.last_run_at
    ? row.trigger_type === "定时触发"
      ? formatDateTimeInZone(row.last_run_at, scheduleTimezone)
      : new Date(row.last_run_at).toLocaleString("zh-CN")
    : "";
  const nextRunDisplay = row.next_run_at
    ? row.trigger_type === "定时触发"
      ? formatDateTimeInZone(row.next_run_at, scheduleTimezone)
      : new Date(row.next_run_at).toLocaleString("zh-CN")
    : "";

  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger_type,
    triggerDetail,
    appId: row.app_id,
    agent: row.agent_name,
    strategy: row.strategy,
    status: row.status,
    statusText,
    time: lastRunDisplay
      ? lastRunDisplay
      : nextRunDisplay
        ? `下次 ${nextRunDisplay}`
        : "尚未运行",
    task: row.task,
    returnDetail: [
      "平台内保存",
      resultConfig.resultEmail ? `发送至邮箱 ${resultConfig.resultEmail}` : null,
      resultConfig.callbackUrl ? "发送至接收 URL" : null,
    ]
      .filter(Boolean)
      .join(" + "),
    resultEmail: resultConfig.resultEmail || undefined,
    resultEmailIncludeAttachments: Boolean(resultConfig.resultEmailIncludeAttachments),
    callbackUrl: resultConfig.callbackUrl || undefined,
    callbackTiming: resultConfig.callbackTiming || undefined,
    callbackAuth: resultConfig.callbackAuth || undefined,
    schedulePeriod: config.period,
    scheduleTime: config.time,
    scheduleTimezone: row.trigger_type === "定时触发" ? scheduleTimezone : config.timezone,
    scheduleWeekdays,
    scheduleMonthlyMode: config.monthlyMode === "last_day" ? "last_day" : "fixed_day",
    scheduleDayOfMonth:
      Number.isInteger(Number(config.dayOfMonth)) ? Number(config.dayOfMonth) : undefined,
    scheduleMissingDayPolicy:
      config.missingDayPolicy === "skip" ? "skip" : "last_day",
    scheduleDate,
    mailboxKey: config.mailboxKey || "system",
    mailboxLabel: config.mailboxLabel || "系统邮箱",
    mailFolder: config.folder || "INBOX",
    mailRuleMode: (config.ruleMode === "any" ? "any" : "all") as EmailRuleMode,
    mailRules: normalizeEmailRules(config.rules),
    mailPriority: normalizeEmailPriority(config.priority),
    upstreamAutomationId: config.upstreamAutomationId ?? undefined,
    upstreamCondition: config.upstreamCondition ?? undefined,
    passPreviousResult: config.passPreviousResult ?? undefined,
    nextRunAt: row.next_run_at || null,
    lastRunAt: row.last_run_at || null,
    lastRunStatus: row.last_run_status || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function runRowToApi(row: any) {
  const statusText =
    row.status === "success"
      ? "成功"
      : row.status === "failed"
        ? "失败"
        : row.status === "pending"
          ? "待审核"
          : row.status === "regenerating"
            ? "重新生成中"
            : row.status === "rejected"
              ? "已驳回"
              : row.status === "timed_out"
                ? "已超时"
                : row.status === "action_running"
                  ? "执行后续操作"
                  : "执行中";

  const duration =
    typeof row.duration_ms === "number"
      ? `${Math.max(1, Math.round(row.duration_ms / 1000))}s`
      : "-";

  return {
    id: row.id,
    automationId: row.automation_id,
    time: new Date(row.started_at).toLocaleString("zh-CN"),
    name: row.automation_name,
    trigger: row.trigger_type,
    agent: row.agent_name,
    status: row.status,
    statusText,
    duration,
    result: row.result || undefined,
    aiResult: row.ai_result || undefined,
    reviewContent: row.review_content || undefined,
    finalResult: row.final_result || undefined,
    resultAttachments: Array.isArray(row.result_attachments) ? row.result_attachments : [],
    aiVersion: Number(row.ai_version || 0),
    reviewStatus: row.review_status || "not_required",
    reviewerUserId: row.reviewer_user_id || undefined,
    reviewedAt: row.reviewed_at || undefined,
    rejectionReason: row.rejection_reason || undefined,
    actionStatus: row.action_status || "not_started",
    strategy: row.strategy_snapshot || undefined,
    taskSnapshot: row.task_snapshot || undefined,
    resultConfigSnapshot: row.result_config_snapshot || {},
    error: row.error || undefined,
    triggerContext: row.trigger_context || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export async function listActiveEmailAutomationsForScheduler() {
  await ensureAutomationTables();
  const result = await pool.query(
    `SELECT * FROM automation_tasks
     WHERE trigger_type='邮件触发'
       AND status='running'
     ORDER BY created_by_user_id ASC, id ASC`
  );
  return result.rows;
}

export async function getAutomationEmailMailboxCursor(
  userId: number,
  mailboxKey: string
) {
  await ensureAutomationTables();
  const safeMailboxKey = String(mailboxKey || "system").trim() || "system";
  const result = await pool.query(
    `SELECT last_uid, initialized, updated_at
     FROM automation_email_mailbox_cursors
     WHERE created_by_user_id=$1 AND mailbox_key=$2
     LIMIT 1`,
    [userId, safeMailboxKey]
  );

  const row = result.rows[0];
  return {
    lastUid: Number(row?.last_uid || 0),
    initialized: Boolean(row?.initialized),
    updatedAt: row?.updated_at || null,
  };
}

export async function saveAutomationEmailMailboxCursor(
  userId: number,
  mailboxKey: string,
  lastUid: number,
  initialized = true
) {
  await ensureAutomationTables();
  const safeMailboxKey = String(mailboxKey || "system").trim() || "system";
  const safeUid = Number.isFinite(Number(lastUid)) ? Math.max(0, Math.floor(Number(lastUid))) : 0;

  const result = await pool.query(
    `INSERT INTO automation_email_mailbox_cursors (
       created_by_user_id, mailbox_key, last_uid, initialized, updated_at
     ) VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (created_by_user_id, mailbox_key) DO UPDATE SET
       last_uid=GREATEST(automation_email_mailbox_cursors.last_uid, EXCLUDED.last_uid),
       initialized=automation_email_mailbox_cursors.initialized OR EXCLUDED.initialized,
       updated_at=NOW()
     RETURNING *`,
    [userId, safeMailboxKey, safeUid, initialized]
  );

  return result.rows[0] || null;
}

