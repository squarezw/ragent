import cron, { type ScheduledTask } from "node-cron";
import jwt from "jsonwebtoken";
import pool from "@/lib/db";
import { executeAutomationAgent, isAutomationTimeoutError } from "@/lib/automation/execute";
import { executeRunActions } from "@/lib/automation/actions";
import {
  claimAutomationEmailMessage,
  claimDueScheduledRun,
  createRun,
  ensureAutomationTables,
  finishRun,
  getAutomationEmailMailboxCursor,
  listActiveEmailAutomationsForScheduler,
  markRunPendingReview,
  prepareAutomaticRunActions,
  recordAutomationEmailRuleEvaluations,
  saveAutomationEmailMailboxCursor,
  saveRunExecutionArtifacts,
} from "@/lib/automation/store";
import {
  getAutomationMailboxForUser,
  mailboxConnectionFromRow,
} from "@/lib/automation/mailboxes";
import { fetchMailboxUnread } from "@/lib/automation/mailbox-client";

declare global {
  // eslint-disable-next-line no-var
  var automationCronTask: ScheduledTask | undefined;
  // eslint-disable-next-line no-var
  var automationCronBusy: boolean | undefined;
  // eslint-disable-next-line no-var
  var automationEmailCronTask: ScheduledTask | undefined;
  // eslint-disable-next-line no-var
  var automationEmailCronBusy: boolean | undefined;
}

const ADVISORY_LOCK_NAMESPACE = 20260903;

type InboxMessage = {
  uid: number;
  message_id?: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  body?: string;
  attachments?: string[];
};

type MailTriggerRule = {
  id?: string;
  field: string;
  operator: string;
  value?: string;
};

function isScheduleConfigurationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.startsWith("SCHEDULE_");
}

async function executeDueAutomation(automationId: number) {
  const lockClient = await pool.connect();
  let locked = false;

  try {
    const lockResult = await lockClient.query(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [ADVISORY_LOCK_NAMESPACE, automationId],
    );
    locked = Boolean(lockResult.rows[0]?.locked);
    if (!locked) return;

    let claimed: Awaited<ReturnType<typeof claimDueScheduledRun>>;
    try {
      // Store 会在同一个数据库事务里完成：
      // 锁定到期任务 -> 创建 Run -> 推进 next_run_at -> 提交。
      // 只有事务提交成功后才开始执行 AI，避免重复触发和“已推进但没有 Run”的丢任务窗口。
      claimed = await claimDueScheduledRun(automationId);
    } catch (error) {
      if (isScheduleConfigurationError(error)) {
        // 历史数据如果存在无法解析的旧定时配置，直接暂停该任务，
        // 避免 Scheduler 每分钟反复扫描同一个无效任务。
        await lockClient.query(
          `UPDATE automation_tasks SET
             status='paused', next_run_at=NULL, last_run_status='failed', updated_at=NOW()
           WHERE id=$1
             AND status='running'
             AND trigger_type='定时触发'`,
          [automationId],
        );
        console.error(
          `[Automation Cron] automation ${automationId}: invalid schedule; paused to prevent repeated execution`,
          error,
        );
        return;
      }
      throw error;
    }

    if (!claimed) return;

    const { task, run, scheduledFor } = claimed;

    try {
      const result = await executeAutomationAgent({
        userId: task.created_by_user_id,
        appId: task.app_id,
        question: task.task,
      });

      const answer = result.answer || "任务已完成，未返回文本结果";
      await saveRunExecutionArtifacts(run.id, result.attachments);
      const needsReview = task.strategy === "需要确认后执行";
      let lastRunStatus = "success";

      if (needsReview) {
        await markRunPendingReview(run.id, answer);
        lastRunStatus = "pending";
      } else if (task.strategy === "自动执行") {
        const prepared = await prepareAutomaticRunActions(
          Number(task.created_by_user_id),
          run.id,
          answer,
        );

        if (prepared?.status === "action_running") {
          const executed = await executeRunActions({
            userId: Number(task.created_by_user_id),
            runId: run.id,
          });
          lastRunStatus = executed.run.status === "failed" ? "failed" : "success";
        }
      } else {
        await finishRun(run.id, "success", answer);
      }

      await lockClient.query(
        `UPDATE automation_tasks SET
           last_run_at=NOW(), last_run_status=$1, updated_at=NOW()
         WHERE id=$2`,
        [lastRunStatus, task.id],
      );

      console.log(
        needsReview
          ? `[Automation Cron] ${task.id} ${task.name}: AI result ready, pending review · scheduled ${scheduledFor}`
          : `[Automation Cron] ${task.id} ${task.name}: ${lastRunStatus} · scheduled ${scheduledFor}`,
      );
    } catch (error: any) {
      const timedOut = isAutomationTimeoutError(error);
      const message = error?.message || "Automation execution failed";
      const runStatus = timedOut ? "timed_out" : "failed";
      const partialResult = timedOut ? error.partialAnswer || undefined : undefined;
      await finishRun(run.id, runStatus, partialResult, String(message));

      await lockClient.query(
        `UPDATE automation_tasks SET
           last_run_at=NOW(), last_run_status=$1, updated_at=NOW()
         WHERE id=$2`,
        [runStatus, task.id],
      );

      console.error(
        `[Automation Cron] ${task.id} ${task.name}: ${timedOut ? "timed out" : "failed"} · scheduled ${scheduledFor}`,
        error,
      );
    }
  } catch (error) {
    console.error(`[Automation Cron] automation ${automationId}: execution claim failed`, error);
  } finally {
    if (locked) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [
          ADVISORY_LOCK_NAMESPACE,
          automationId,
        ]);
      } catch (unlockError) {
        console.error("[Automation Cron] unlock failed:", unlockError);
      }
    }
    lockClient.release();
  }
}

export async function scanDueAutomations() {
  if (global.automationCronBusy) return;
  global.automationCronBusy = true;

  try {
    await ensureAutomationTables();

    const result = await pool.query(`
      SELECT id FROM automation_tasks
      WHERE status='running'
        AND trigger_type='定时触发'
        AND next_run_at IS NOT NULL
        AND next_run_at <= NOW()
      ORDER BY next_run_at ASC
      LIMIT 20
    `);

    await Promise.all(result.rows.map((row) => executeDueAutomation(Number(row.id))));
  } catch (error) {
    console.error("[Automation Cron] scan failed:", error);
  } finally {
    global.automationCronBusy = false;
  }
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function serverAuthorization(userId: number) {
  const token = jwt.sign({ userId }, requiredEnv("JWT_SECRET"), { expiresIn: "15m" });
  return `Bearer ${token}`;
}

function mailboxIdFromKey(mailboxKey: string) {
  const match = String(mailboxKey || "").match(/^mailbox:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function extractSenderDomain(value?: string) {
  const match = String(value || "").match(/@([^>\s,;]+)/);
  return match?.[1]?.toLowerCase() || "";
}

function attachmentExtensions(names?: string[]) {
  return (Array.isArray(names) ? names : [])
    .map((name) => {
      const match = String(name).toLowerCase().match(/(\.[a-z0-9]+)$/i);
      return match?.[1] || "";
    })
    .filter(Boolean)
    .join(" ");
}

function mailRuleSource(rule: MailTriggerRule, message: InboxMessage) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  switch (rule.field) {
    case "发件人": return String(message.from || "");
    case "发件人域名": return extractSenderDomain(message.from);
    case "收件人": return String(message.to || "");
    case "邮件主题": return String(message.subject || "");
    case "邮件正文": return String(message.body || "");
    case "是否包含附件": return attachments.length > 0 ? "是" : "否";
    case "附件名称": return attachments.join(" ");
    case "附件类型": return attachmentExtensions(attachments);
    default: return "";
  }
}

function doesMailRuleMatch(rule: MailTriggerRule, message: InboxMessage) {
  const source = mailRuleSource(rule, message).toLowerCase();
  const wanted = String(rule.value || "").trim().toLowerCase();

  if (rule.operator === "是否存在" || rule.field === "是否包含附件") {
    const exists = rule.field === "是否包含附件" ? source === "是" : source.trim().length > 0;
    const wantExists = !["否", "false", "0", "no"].includes(wanted || "是");
    return exists === wantExists;
  }

  if (!wanted) return false;
  if (rule.operator === "等于") return source.trim() === wanted;
  if (rule.operator === "包含") return source.includes(wanted);
  if (rule.operator === "不包含") return !source.includes(wanted);
  if (rule.operator === "开头是") return source.startsWith(wanted);
  if (rule.operator === "结尾是") return source.endsWith(wanted);
  return false;
}

function mailAutomationMatches(task: any, message: InboxMessage) {
  const config = task.trigger_config || {};
  const rules: MailTriggerRule[] = Array.isArray(config.rules) ? config.rules : [];
  if (rules.length === 0) return true;
  const results = rules.map((rule) => doesMailRuleMatch(rule, message));
  return config.ruleMode === "any" ? results.some(Boolean) : results.every(Boolean);
}

function mailRuleText(rule: MailTriggerRule) {
  if (rule.operator === "是否存在" || rule.field === "是否包含附件") {
    return `${rule.field}${rule.value || "是"}`;
  }
  return `${rule.field}${rule.operator}“${rule.value || ""}”`;
}

function mailRulesSummary(task: any) {
  const config = task.trigger_config || {};
  const rules: MailTriggerRule[] = Array.isArray(config.rules) ? config.rules : [];
  if (rules.length === 0) return "收到新邮件即触发";
  const prefix = config.ruleMode === "any" ? "任一" : "全部";
  return `${prefix}：${rules.map(mailRuleText).join("；")}`;
}

async function fetchSystemMailboxUnread(userId: number, afterUid?: number) {
  const backendUrl = requiredEnv("EXTERNAL_API_BASE_URL").replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (Number.isInteger(afterUid)) params.set("after_uid", String(afterUid));
  const response = await fetch(
    `${backendUrl}/api/v1/email/unread${params.toString() ? `?${params.toString()}` : ""}`,
    { headers: { Authorization: serverAuthorization(userId) } }
  );

  const raw = await response.text();
  let data: any = raw;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* keep raw */ }

  if (!response.ok) {
    const detail = typeof data === "object" && data?.detail ? data.detail : String(data || `HTTP ${response.status}`);
    throw new Error(detail);
  }
  return data ?? { success: true, latest_uid: 0, messages: [] };
}

async function fetchConfiguredMailboxUnread(
  userId: number,
  mailboxKey: string,
  afterUid?: number
) {
  if (mailboxKey === "system") {
    return fetchSystemMailboxUnread(userId, afterUid);
  }

  const mailboxId = mailboxIdFromKey(mailboxKey);
  if (!mailboxId) throw new Error(`监听邮箱标识无效：${mailboxKey}`);

  const mailbox = await getAutomationMailboxForUser(userId, mailboxId);
  if (!mailbox) throw new Error(`监听邮箱不存在：${mailboxKey}`);

  return fetchMailboxUnread({
    authorization: serverAuthorization(userId),
    afterUid,
    connection: mailboxConnectionFromRow(mailbox),
  });
}

async function executeEmailAutomation(task: any, message: InboxMessage) {
  const config = task.trigger_config || {};
  const attachments = Array.isArray(message.attachments) && message.attachments.length > 0
    ? message.attachments.join("、")
    : "无";

  const rawBody = typeof message.body === "string" ? message.body.trim() : "";
  const body = rawBody.length > 20000
    ? `${rawBody.slice(0, 20000)}\n\n[正文较长，已截取前 20000 个字符]`
    : rawBody || "（无正文）";

  const question = [
    "【自动化任务】",
    String(task.task || ""),
    "",
    "【本次收到的新邮件】",
    `监听邮箱：${config.mailboxLabel || "系统邮箱"}`,
    `发件人：${message.from || "未知"}`,
    `收件人：${message.to || "未知"}`,
    `主题：${message.subject || "无主题"}`,
    `时间：${message.date || "未知"}`,
    `附件：${attachments}`,
    "正文：",
    body,
    "",
    "【执行要求】",
    "请根据上面的真实邮件内容完成自动化任务。",
    "只输出本次邮件的处理结果，不要自行调用发送邮件、通知或其他外部发送工具；结果将由自动化统一发送。",
  ].join("\n");

  const triggerContext = {
    source: "email-server",
    firedAt: new Date().toISOString(),
    uid: Number(message.uid),
    messageId: message.message_id || undefined,
    mailboxKey: config.mailboxKey || "system",
    mailbox: config.mailboxLabel || "系统邮箱",
    folder: config.folder || "INBOX",
    matchedRule: mailRulesSummary(task),
    priority: Number(config.priority ?? 50),
    from: message.from,
    to: message.to,
    subject: message.subject,
    date: message.date,
    body,
    attachments: message.attachments || [],
  };

  const run = await createRun(task, "running", triggerContext);

  try {
    const result = await executeAutomationAgent({
      userId: Number(task.created_by_user_id),
      appId: Number(task.app_id),
      question,
    });

    const answer = result.answer || "任务已完成，未返回文本结果";
    await saveRunExecutionArtifacts(run.id, result.attachments);
    let lastRunStatus = "success";

    if (task.strategy === "需要确认后执行") {
      await markRunPendingReview(run.id, answer);
      lastRunStatus = "pending";
    } else if (task.strategy === "自动执行") {
      const prepared = await prepareAutomaticRunActions(
        Number(task.created_by_user_id),
        run.id,
        answer
      );
      if (prepared?.status === "action_running") {
        const executed = await executeRunActions({
          userId: Number(task.created_by_user_id),
          runId: run.id,
        });
        lastRunStatus = executed.run.status === "failed" ? "failed" : "success";
      }
    } else {
      await finishRun(run.id, "success", answer);
    }

    await pool.query(
      `UPDATE automation_tasks SET
         last_run_at=NOW(), last_run_status=$1, updated_at=NOW()
       WHERE id=$2`,
      [lastRunStatus, task.id]
    );

    console.log(
      `[Automation Email] ${task.id} ${task.name}: ${lastRunStatus} · ${message.subject || "无主题"}`
    );
  } catch (error: any) {
    const timedOut = isAutomationTimeoutError(error);
    const messageText = error?.message || "Automation execution failed";
    const runStatus = timedOut ? "timed_out" : "failed";
    const partialResult = timedOut ? error.partialAnswer || undefined : undefined;
    await finishRun(run.id, runStatus, partialResult, String(messageText));
    await pool.query(
      `UPDATE automation_tasks SET
         last_run_at=NOW(), last_run_status=$1, updated_at=NOW()
       WHERE id=$2`,
      [runStatus, task.id]
    );
    console.error(
      `[Automation Email] ${task.id} ${task.name}: ${timedOut ? "timed out" : "failed"}`,
      error,
    );
  }
}

async function processEmailMailboxGroup(tasks: any[]) {
  if (tasks.length === 0) return;

  const userId = Number(tasks[0].created_by_user_id);
  const config = tasks[0].trigger_config || {};
  const mailboxKey = String(config.mailboxKey || "system").trim() || "system";
  const cursor = await getAutomationEmailMailboxCursor(userId, mailboxKey);

  const data = await fetchConfiguredMailboxUnread(
    userId,
    mailboxKey,
    cursor.initialized ? cursor.lastUid : undefined
  );

  const latestUid = Number(data?.latest_uid || 0);
  const messages: InboxMessage[] = Array.isArray(data?.messages) ? data.messages : [];

  // 第一次建立服务端基线，不处理历史邮件。
  if (!cursor.initialized) {
    await saveAutomationEmailMailboxCursor(userId, mailboxKey, latestUid, true);
    return;
  }

  const ordered = messages
    .filter((message) => Number.isInteger(Number(message.uid)) && Number(message.uid) > cursor.lastUid)
    .sort((a, b) => Number(a.uid) - Number(b.uid));

  for (const message of ordered) {
    const uid = Number(message.uid);
    const subject = String(message.subject || "").trim();

    // 防止平台自己发送的结果邮件再次触发自动化形成循环。
    if (!subject.startsWith("自动化执行结果：") && !subject.startsWith("[AI对话]")) {
      const messageKey = String(message.message_id || "").trim() || `uid:${uid}`;
      const matched = tasks
        .filter((task) => mailAutomationMatches(task, message))
        .sort((a, b) => {
          const priorityDelta = Number(b.trigger_config?.priority ?? 50) - Number(a.trigger_config?.priority ?? 50);
          return priorityDelta !== 0 ? priorityDelta : Number(a.id) - Number(b.id);
        });

      const winner = matched[0];
      let claimed = false;
      if (winner) {
        claimed = await claimAutomationEmailMessage(
          userId,
          mailboxKey,
          messageKey,
          Number(winner.id)
        );
      }

      const matchedIds = new Set(matched.map((task) => Number(task.id)));
      await recordAutomationEmailRuleEvaluations(
        tasks.map((task) => {
          const taskId = Number(task.id);
          let outcome: "triggered" | "suppressed_by_priority" | "not_matched" | "duplicate";
          if (!matchedIds.has(taskId)) {
            outcome = "not_matched";
          } else if (winner && taskId === Number(winner.id)) {
            outcome = claimed ? "triggered" : "duplicate";
          } else {
            outcome = "suppressed_by_priority";
          }

          return {
            userId,
            mailboxKey,
            messageKey,
            messageUid: uid,
            automationId: taskId,
            outcome,
            winnerAutomationId: winner ? Number(winner.id) : null,
            matchedRule: mailRulesSummary(task),
            priority: Number(task.trigger_config?.priority ?? 50),
            from: message.from,
            to: message.to,
            subject: message.subject,
            date: message.date,
          };
        })
      );

      if (winner && claimed) {
        await executeEmailAutomation(winner, message);
      }
    }

    // 无论是否命中规则都推进游标；规则调整不会回溯历史邮件。
    await saveAutomationEmailMailboxCursor(userId, mailboxKey, uid, true);
  }
}

export async function scanEmailAutomations() {
  if (global.automationEmailCronBusy) return;
  global.automationEmailCronBusy = true;

  try {
    const tasks = await listActiveEmailAutomationsForScheduler();
    const groups = new Map<string, any[]>();

    for (const task of tasks) {
      const userId = Number(task.created_by_user_id);
      const mailboxKey = String(task.trigger_config?.mailboxKey || "system").trim() || "system";
      const key = `${userId}:${mailboxKey}`;
      const current = groups.get(key) || [];
      current.push(task);
      groups.set(key, current);
    }

    for (const groupTasks of groups.values()) {
      try {
        await processEmailMailboxGroup(groupTasks);
      } catch (error) {
        const first = groupTasks[0];
        console.error(
          `[Automation Email] mailbox scan failed: user=${first?.created_by_user_id} mailbox=${first?.trigger_config?.mailboxKey || "system"}`,
          error
        );
      }
    }
  } catch (error) {
    console.error("[Automation Email] scan failed:", error);
  } finally {
    global.automationEmailCronBusy = false;
  }
}

export async function initAutomationScheduler() {
  await ensureAutomationTables();

  if (!global.automationCronTask) {
    await scanDueAutomations();
    global.automationCronTask = cron.schedule("* * * * *", () => {
      void scanDueAutomations();
    });
    console.log("[Automation Cron] scheduler initialized (every minute)");
  } else {
    console.log("[Automation Cron] scheduler already initialized");
  }

  if (!global.automationEmailCronTask) {
    await scanEmailAutomations();
    global.automationEmailCronTask = cron.schedule("*/10 * * * * *", () => {
      void scanEmailAutomations();
    });
    console.log("[Automation Email] scheduler initialized (every 10 seconds)");
  } else {
    console.log("[Automation Email] scheduler already initialized");
  }
}
