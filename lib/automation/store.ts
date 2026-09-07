import pool from "@/lib/db";
import { getUserTenantId } from "@/lib/tenantMapping";

export type AutomationTriggerType = "定时触发" | "邮件触发" | "Webhook / API" | "自动化完成触发";

export type AutomationStrategy = "仅生成结果" | "需要确认后执行" | "自动执行";

export type AutomationStatus = "running" | "paused" | "error";

export interface ScheduleConfig {
  period: "每天" | "每周" | "每月" | "仅一次";
  time: string;
  timezone: string;
  weekday?: number;
  dayOfMonth?: number;
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
    `);
  })().catch((error) => {
    initPromise = null;
    throw error;
  });

  return initPromise;
}

function cleanTimeZone(value?: string) {
  const zone = (value || "Asia/Shanghai").replace(/（.*?）/g, "").trim();
  return zone || "Asia/Shanghai";
}

function validTime(value?: string) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
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

function zonedDateTimeToUtc(
  target: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string
) {
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

  for (let i = 0; i < 4; i += 1) {
    const got = zonedParts(new Date(guess), timeZone);
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, 0, 0);
    const delta = wantedAsUtc - gotAsUtc;
    guess += delta;
    if (Math.abs(delta) < 1000) break;
  }

  return new Date(guess);
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

export function normalizeScheduleConfig(
  input: Partial<ScheduleConfig>,
  now = new Date()
): ScheduleConfig {
  const period =
    input.period === "每周" || input.period === "每月" || input.period === "仅一次"
      ? input.period
      : "每天";

  const time = validTime(input.time) ? input.time! : "09:00";
  const timezone = cleanTimeZone(input.timezone);

  const current = zonedParts(now, timezone);
  const config: ScheduleConfig = { period, time, timezone };

  if (period === "每周") {
    config.weekday =
      Number.isInteger(input.weekday) && Number(input.weekday) >= 0 && Number(input.weekday) <= 6
        ? Number(input.weekday)
        : current.weekday;
  }

  if (period === "每月") {
    config.dayOfMonth =
      Number.isInteger(input.dayOfMonth) &&
      Number(input.dayOfMonth) >= 1 &&
      Number(input.dayOfMonth) <= 31
        ? Number(input.dayOfMonth)
        : current.day;
  }

  if (period === "仅一次" && input.runAt) {
    const parsed = new Date(input.runAt);
    if (!Number.isNaN(parsed.getTime())) config.runAt = parsed.toISOString();
  }

  if (period === "仅一次" && !config.runAt) {
    const temp: ScheduleConfig = { ...config, period: "每天" };
    const next = computeNextRunAt(temp, now);
    if (next) config.runAt = next.toISOString();
  }

  return config;
}

export function computeNextRunAt(
  configInput: Partial<ScheduleConfig>,
  after = new Date()
): Date | null {
  const config = {
    ...configInput,
    timezone: cleanTimeZone(configInput.timezone),
    time: validTime(configInput.time) ? configInput.time! : "09:00",
  } as ScheduleConfig;

  if (config.period === "仅一次" && config.runAt) {
    const runAt = new Date(config.runAt);
    return !Number.isNaN(runAt.getTime()) && runAt.getTime() > after.getTime() ? runAt : null;
  }

  const [hour, minute] = config.time.split(":").map(Number);
  const localNow = zonedParts(after, config.timezone);
  const makeCandidate = (year: number, month: number, day: number) =>
    zonedDateTimeToUtc({ year, month, day, hour, minute }, config.timezone);

  if (config.period === "每周") {
    const targetWeekday = Number.isInteger(config.weekday)
      ? Number(config.weekday)
      : localNow.weekday;
    const delta = (targetWeekday - localNow.weekday + 7) % 7;
    let date = addCalendarDays(localNow, delta);
    let candidate = makeCandidate(date.year, date.month, date.day);

    if (candidate.getTime() <= after.getTime()) {
      date = addCalendarDays(date, 7);
      candidate = makeCandidate(date.year, date.month, date.day);
    }
    return candidate;
  }

  if (config.period === "每月") {
    const requestedDay = Number.isInteger(config.dayOfMonth)
      ? Number(config.dayOfMonth)
      : localNow.day;

    const buildForMonth = (year: number, month: number) => {
      const day = Math.min(requestedDay, daysInMonth(year, month));
      return makeCandidate(year, month, day);
    };

    let candidate = buildForMonth(localNow.year, localNow.month);
    if (candidate.getTime() <= after.getTime()) {
      const nextMonth = addMonths(localNow.year, localNow.month, 1);
      candidate = buildForMonth(nextMonth.year, nextMonth.month);
    }
    return candidate;
  }

  let date = { year: localNow.year, month: localNow.month, day: localNow.day };
  let candidate = makeCandidate(date.year, date.month, date.day);

  if (candidate.getTime() <= after.getTime()) {
    date = addCalendarDays(date, 1);
    candidate = makeCandidate(date.year, date.month, date.day);
  }
  return candidate;
}

export async function resolveAppName(appId: number) {
  const result = await pool.query("SELECT name FROM apps WHERE id = $1", [appId]);
  return result.rows[0]?.name ? String(result.rows[0].name) : null;
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
    const schedule = normalizeScheduleConfig({
      period: input.schedulePeriod ?? input.triggerConfig?.period,
      time: input.scheduleTime ?? input.triggerConfig?.time,
      timezone: input.scheduleTimezone ?? input.triggerConfig?.timezone,
      weekday: input.triggerConfig?.weekday,
      dayOfMonth: input.triggerConfig?.dayOfMonth,
      runAt: input.triggerConfig?.runAt,
    });
    Object.assign(triggerConfig, schedule);
    nextRunAt = status === "running" ? computeNextRunAt(schedule) : null;
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
    const schedule = normalizeScheduleConfig({
      period: input.schedulePeriod ?? input.triggerConfig?.period ?? triggerConfig.period,
      time: input.scheduleTime ?? input.triggerConfig?.time ?? triggerConfig.time,
      timezone: input.scheduleTimezone ?? input.triggerConfig?.timezone ?? triggerConfig.timezone,
      weekday: input.triggerConfig?.weekday ?? triggerConfig.weekday,
      dayOfMonth: input.triggerConfig?.dayOfMonth ?? triggerConfig.dayOfMonth,
      runAt: input.triggerConfig?.runAt ?? triggerConfig.runAt,
    });
    triggerConfig = schedule;
    nextRunAt = status === "running" ? computeNextRunAt(schedule) : null;
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

export async function createRun(
  task: any,
  status: "running" | "pending",
  triggerContext: Record<string, any> = {}
) {
  await ensureAutomationTables();

  const needsReview = task.strategy === "需要确认后执行";
  const result = await pool.query(
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
  return result.rows[0];
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
      config: { to: resultEmail },
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
        status=$1,
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
        finished_at=CASE WHEN $1='success' THEN NOW() ELSE NULL END,
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
  status: "success" | "failed",
  resultText?: string,
  errorText?: string
) {
  await ensureAutomationTables();

  const result = await pool.query(
    `UPDATE automation_runs SET
      status=$1,
      result=$2,
      ai_result=CASE WHEN $1='success' AND $2 IS NOT NULL THEN COALESCE(ai_result, $2) ELSE ai_result END,
      final_result=CASE
        WHEN $1='success' AND review_status='not_required' THEN $2
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
        status=$1,
        result=$2,
        review_content=$2,
        final_result=$2,
        review_status='approved',
        action_status=$3,
        reviewer_user_id=$4,
        reviewed_at=NOW(),
        rejection_reason=NULL,
        error=NULL,
        finished_at=CASE WHEN $1='success' THEN NOW() ELSE NULL END,
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

  const triggerDetail =
    row.trigger_type === "定时触发"
      ? `${config.period || "每天"} ${config.time || "09:00"} · ${config.timezone || "Asia/Shanghai"}`
      : row.trigger_type === "邮件触发"
        ? "系统邮箱 · 收到新邮件即触发"
        : row.trigger_type === "Webhook / API"
          ? "由外部系统通过 Webhook / API 触发"
          : "上游自动化完成后触发";

  const statusText =
    row.status === "paused" ? "已暂停" : row.status === "error" ? "异常" : "运行中";

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
    time: row.last_run_at
      ? new Date(row.last_run_at).toLocaleString("zh-CN")
      : row.next_run_at
        ? `下次 ${new Date(row.next_run_at).toLocaleString("zh-CN")}`
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
    callbackUrl: resultConfig.callbackUrl || undefined,
    callbackTiming: resultConfig.callbackTiming || undefined,
    callbackAuth: resultConfig.callbackAuth || undefined,
    schedulePeriod: config.period,
    scheduleTime: config.time,
    scheduleTimezone: config.timezone,
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
