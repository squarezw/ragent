import cron, { type ScheduledTask } from "node-cron";
import pool from "@/lib/db";
import { assertAutomationTablesReady } from "@/lib/automation/schema";
import { executeAutomationAgent, isAutomationTimeoutError } from "@/lib/automation/execute";
import { executeRunActions } from "@/lib/automation/actions";
import {
  claimAutomationEmailMessage,
  claimDueScheduledRun,
  cleanupAutomationEmailProcessedMessages,
  createRun,
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
  markAutomationMailboxConnected,
  markAutomationMailboxConnectionError,
} from "@/lib/automation/mailboxes";
import {
  mailboxGroupKey,
  normalizeMailboxId,
  requireMailboxId,
  requireMailboxLabel,
} from "@/lib/automation/mailbox-id";
import {
  fetchMailboxUnread,
  fetchMessageAttachments,
  splitAttachmentsBySize,
  type MailboxAttachmentFile,
} from "@/lib/automation/imap-client";
import {
  buildEmailAutomationQuestion,
  normalizeEmailBody,
  type AutomationAgentAttachment,
} from "@/lib/automation/agent-payload";
import { ossClient } from "@/lib/ossClient";
import {
  doesMailRuleSetMatch,
  type MailRuleSet,
  mailRulesSummary,
} from "@/lib/automation/mail-rules";

declare global {
  // eslint-disable-next-line no-var
  var automationCronTask: ScheduledTask | undefined;
  // eslint-disable-next-line no-var
  var automationCronBusy: boolean | undefined;
  // eslint-disable-next-line no-var
  var automationEmailCronTask: ScheduledTask | undefined;
  // eslint-disable-next-line no-var
  var automationEmailCronBusy: boolean | undefined;
  // eslint-disable-next-line no-var
  var automationEmailCleanupTask: ScheduledTask | undefined;
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
    await assertAutomationTablesReady();

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

// 任务行（automation_tasks）到规范化规则集的适配；规则逻辑本身在 mail-rules.ts。
function mailRuleSetFromTask(task: any): MailRuleSet {
  const config = task.trigger_config || {};
  return { rules: config.rules, mode: config.ruleMode };
}

async function fetchConfiguredMailboxUnread(
  userId: number,
  mailboxId: number,
  afterUid?: number
) {
  const mailbox = await getAutomationMailboxForUser(userId, mailboxId);
  if (!mailbox) throw new Error(`监听邮箱不存在：${mailboxId}`);

  try {
    // 解密失败（凭据被换过密钥、授权码被清空）与 IMAP 连不上在这里是同一件事：
    // 这条邮箱管道这次收信失败了，用户看到的都该是"邮箱连接失败"。
    // 收信是本进程内的直接调用（`lib/automation/imap-client.ts`）：不再需要服务间 JWT，
    // 也就不再需要一遍自我 HTTP 回调。
    const data = await fetchMailboxUnread({
      afterUid,
      connection: mailboxConnectionFromRow(mailbox),
    });

    // 模块 E.1：连上了就恢复状态。只在"当前不是 connected"时才写库——正常轮询（每 10 秒一次）
    // 不产生任何写入；判断用的是上面取到的那一行，省掉一次查询。
    if (mailbox.status !== "connected") {
      await markAutomationMailboxConnected(userId, mailboxId);
    }

    return data;
  } catch (error) {
    // 模块 E.1/E.2：一次写入点亮三处（抽屉徽标、抽屉的「最后错误」、通知中心里按
    // status='error' 派生的那条提醒）。记录失败不抛错，原始错误照旧往上抛给分组层的日志。
    await markAutomationMailboxConnectionError(userId, mailboxId, error);
    throw error;
  }
}

/**
 * 附件准备只用到任务行上的这两个字段。窄类型而非 `any`：顺带说明这个 helper 不碰
 * 任务的其他部分，也让「它需要什么」在签名上直接可读。
 */
type EmailAttachmentTask = {
  created_by_user_id?: unknown;
  trigger_config?: { mailboxId?: unknown } | null;
};

/**
 * 把邮件附件取回来 → 筛掉超限的 → 传上 OSS。
 *
 * 每一层失败都只降级、不抛错：附件是本次任务的输入之一，为它拖垮整次运行不划算。
 * 失败与超限的结果都进 `skippedNames`，最终由提示词点名——模型因此不会把
 * 「只收到一部分」误当成「附件就这些」，进而对缺数据给出错误的解释。
 *
 * 三个名单互斥且穷尽：规则引擎看到过的每个附件名，要么在 `deliveredNames` 里、
 * 要么在 `skippedNames` 里。
 */
async function prepareEmailAttachments(
  task: EmailAttachmentTask,
  message: InboxMessage
): Promise<{
  delivered: AutomationAgentAttachment[];
  deliveredNames: string[];
  skippedNames: string[];
}> {
  // 规则引擎判定时看到的名字（`extractAttachmentNames` 的结果）。没拿到字节的也要在这里露面。
  const seenNames = Array.isArray(message.attachments) ? [...message.attachments] : [];
  const nothingDelivered = {
    delivered: [] as AutomationAgentAttachment[],
    deliveredNames: [] as string[],
    skippedNames: seenNames,
  };

  let files: MailboxAttachmentFile[];
  try {
    const mailbox = await getAutomationMailboxForUser(
      Number(task.created_by_user_id),
      requireMailboxId(task.trigger_config?.mailboxId)
    );
    if (!mailbox) return nothingDelivered;

    files = await fetchMessageAttachments(
      mailboxConnectionFromRow(mailbox),
      Number(message.uid)
    );
  } catch (error) {
    // 取信失败（连接断了、凭据被换过）不该让任务失败——按「没有附件可读」继续。
    console.error("[Automation Email] 读取附件失败，本次按无附件处理:", error);
    return nothingDelivered;
  }

  const { accepted, skipped } = splitAttachmentsBySize(files);
  const skippedNames = skipped.map((file) => file.filename);

  // `mailparser` 没给出字节的 part：规则看得到名字，却没有可传的内容。
  const withBytes = new Set(files.map((file) => file.filename));
  for (const name of seenNames) {
    if (!withBytes.has(name)) skippedNames.push(name);
  }

  const delivered: AutomationAgentAttachment[] = [];
  for (const file of accepted) {
    try {
      const objectKey = await ossClient.upload({
        filename: file.filename,
        content: file.content,
        contentType: file.contentType || "application/octet-stream",
        category: "attachments",
      });

      delivered.push({
        objectKey,
        filename: file.filename,
        contentType: file.contentType,
        size: file.size,
      });
    } catch (error) {
      console.error(`[Automation Email] 附件上传失败，跳过《${file.filename}》:`, error);
      skippedNames.push(file.filename);
    }
  }

  return {
    delivered,
    deliveredNames: delivered.map((item) => item.filename),
    skippedNames,
  };
}

async function executeEmailAutomation(task: any, message: InboxMessage) {
  const config = task.trigger_config || {};
  // 模块 A：展示名在创建/更新时按邮箱记录派生（模块 D.3），这里取不到即数据有问题，
  // 显式抛错而不是兜底成一个已下线的邮箱名。抛错由分组扫描按组记录，不影响其他分组。
  const mailboxLabel = requireMailboxLabel(config.mailboxLabel);

  // 规则判定早就做完了，这里才把字节取回来——只处理真正要执行的那封。
  const emailAttachments = await prepareEmailAttachments(task, message);

  const body = normalizeEmailBody(message.body);

  const question = buildEmailAutomationQuestion({
    task: String(task.task || ""),
    mailboxLabel,
    from: message.from,
    to: message.to,
    subject: message.subject,
    date: message.date,
    // 传原始正文：规范化由 builder 统一做，避免两处各截一次。
    body: message.body,
    delivered: emailAttachments.deliveredNames,
    skipped: emailAttachments.skippedNames,
  });

  const triggerContext = {
    source: "email-server",
    firedAt: new Date().toISOString(),
    uid: Number(message.uid),
    messageId: message.message_id || undefined,
    mailboxId: requireMailboxId(config.mailboxId),
    mailbox: mailboxLabel,
    folder: config.folder || "INBOX",
    matchedRule: mailRulesSummary(mailRuleSetFromTask(task)),
    from: message.from,
    to: message.to,
    subject: message.subject,
    date: message.date,
    body,
    // 保持既有形状：规则引擎与运行详情都按「名字列表」读它。
    attachments: message.attachments || [],
    // 新增：已上传成功的附件元信息，供运行详情给出下载入口。
    attachmentFiles: emailAttachments.delivered,
  };

  const run = await createRun(task, "running", triggerContext);

  try {
    const result = await executeAutomationAgent({
      userId: Number(task.created_by_user_id),
      appId: Number(task.app_id),
      question,
      // 附件以结构化字段下发：后端在 skill 沙箱起容器前取回、写进 inputs/，
      // 模型按文件名引用即可。object_key 不进提示词（见 agent-payload.ts）。
      attachments: emailAttachments.delivered,
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
  // 遗留数据缺少整数 mailboxId 时直接抛错（不再回退 system），错误由 scanEmailAutomations 按分组记录。
  const mailboxId = requireMailboxId(config.mailboxId);
  const cursor = await getAutomationEmailMailboxCursor(userId, mailboxId);

  const data = await fetchConfiguredMailboxUnread(
    userId,
    mailboxId,
    cursor.initialized ? cursor.lastUid : undefined
  );

  const latestUid = Number(data?.latest_uid || 0);
  const messages: InboxMessage[] = Array.isArray(data?.messages) ? data.messages : [];

  // 第一次建立服务端基线，不处理历史邮件。
  if (!cursor.initialized) {
    await saveAutomationEmailMailboxCursor(userId, mailboxId, latestUid, true);
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
          let outcome: "triggered" | "not_matched" | "duplicate";
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
            matchedRule: mailRulesSummary(mailRuleSetFromTask(task)),
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
      const results = await Promise.allSettled(
        claimedTasks.map((task) => executeEmailAutomation(task, message))
      );
      // 不重抛：一条失败不该拖累同一封邮件命中的其他自动化。但也不能不记——
      // executeEmailAutomation 的 try 从 createRun 之后才开始，requireMailboxLabel /
      // requireMailboxId / createRun 抛出时不会写 failed 状态、也没有任何日志，
      // 只在这里落一条带 automation id 的记录，否则这类失败对运维完全不可见。
      // （claim 已写入，重扫会判 duplicate，所以这里只补可观测性，不涉及重试。）
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(
            `[Automation Email] automation ${claimedTasks[index]?.id} failed: user=${userId} mailboxId=${mailboxId} uid=${uid}`,
            result.reason
          );
        }
      });
    }

    // 无论是否命中规则都推进游标；规则调整不会回溯历史邮件。
    await saveAutomationEmailMailboxCursor(userId, mailboxId, uid, true);
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
      // 分组键：同一用户同一监听邮箱为一组（决定 claim 与去重的作用范围）。
      // 遗留数据没有整数 mailboxId，单独归组后由 processEmailMailboxGroup 抛错。
      const mailboxId = normalizeMailboxId(task.trigger_config?.mailboxId);
      const key = mailboxId === null ? `${userId}:MAILBOX_ID_REQUIRED` : mailboxGroupKey(userId, mailboxId);
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
          `[Automation Email] mailbox scan failed: user=${first?.created_by_user_id} automation=${first?.id} mailboxId=${first?.trigger_config?.mailboxId ?? "(缺失)"}`,
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

/**
 * 模块 E.4：去重表保留期清理（每次执行都幂等——一条按 `created_at` 截止的 DELETE）。
 *
 * 失败只记日志：这是维护动作，不该影响邮件扫描本身；下一次执行会补上。
 */
async function runAutomationEmailRetentionCleanup() {
  try {
    const removed = await cleanupAutomationEmailProcessedMessages();
    console.log(`[Automation Email] dedup retention cleanup: ${removed} row(s) removed`);
  } catch (error) {
    console.error("[Automation Email] dedup retention cleanup failed:", error);
  }
}

export async function initAutomationScheduler() {
  await assertAutomationTablesReady();

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

  // 模块 E.4：去重表清理，每天一次。与上面两个扫描任务同一套做法（同一个 node-cron、
  // 同样的 global 句柄防重复初始化），不另起计时器；启动时也跑一次，保证进程活不到每天那个
  // 时刻（频繁重启的部署）也总有机会清理——清理语句幂等，多跑一次没有副作用。
  if (!global.automationEmailCleanupTask) {
    await runAutomationEmailRetentionCleanup();
    global.automationEmailCleanupTask = cron.schedule("0 3 * * *", () => {
      void runAutomationEmailRetentionCleanup();
    });
    console.log("[Automation Email] dedup retention cleanup initialized (daily at 03:00)");
  }
}
