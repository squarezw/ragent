import cron, { type ScheduledTask } from "node-cron";
import pool from "@/lib/db";
import { executeAutomationAgent } from "@/lib/automation/execute";
import { executeRunActions } from "@/lib/automation/actions";
import {
  computeNextRunAt,
  createRun,
  ensureAutomationTables,
  finishRun,
  markRunPendingReview,
  prepareAutomaticRunActions,
  type ScheduleConfig,
} from "@/lib/automation/store";

declare global {
  // eslint-disable-next-line no-var
  var automationCronTask: ScheduledTask | undefined;
  // eslint-disable-next-line no-var
  var automationCronBusy: boolean | undefined;
}

const ADVISORY_LOCK_NAMESPACE = 20260903;

function nextScheduleState(task: any) {
  const config = (task.trigger_config || {}) as ScheduleConfig;

  if (config.period === "仅一次") {
    return { nextRunAt: null, nextStatus: "paused" as const };
  }

  return {
    nextRunAt: computeNextRunAt(config, new Date(Date.now() + 1000)),
    nextStatus: task.status,
  };
}

async function executeDueAutomation(automationId: number) {
  const client = await pool.connect();
  let locked = false;

  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock($1, $2) AS locked", [
      ADVISORY_LOCK_NAMESPACE,
      automationId,
    ]);
    locked = Boolean(lockResult.rows[0]?.locked);
    if (!locked) return;

    const taskResult = await client.query(
      `SELECT * FROM automation_tasks
       WHERE id=$1
         AND status='running'
         AND trigger_type='定时触发'
         AND next_run_at IS NOT NULL
         AND next_run_at <= NOW()
       LIMIT 1`,
      [automationId]
    );

    const task = taskResult.rows[0];
    if (!task) return;

    const triggerContext = {
      source: "server-cron",
      scheduledFor: task.next_run_at,
      firedAt: new Date().toISOString(),
      schedule: task.trigger_config || {},
    };

    const run = await createRun(task, "running", triggerContext);

    try {
      const result = await executeAutomationAgent({
        userId: task.created_by_user_id,
        appId: task.app_id,
        question: task.task,
      });

      const answer = result.answer || "任务已完成，未返回文本结果";
      const needsReview = task.strategy === "需要确认后执行";
      let lastRunStatus = "success";

      if (needsReview) {
        // 数字员工先生成结果，再进入“待审核”。
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
      const { nextRunAt, nextStatus } = nextScheduleState(task);
      await client.query(
        `UPDATE automation_tasks SET
          next_run_at=$1, status=$2, last_run_at=NOW(),
          last_run_status=$3, updated_at=NOW()
         WHERE id=$4`,
        [nextRunAt, nextStatus, lastRunStatus, task.id]
      );

      console.log(
        needsReview
          ? `[Automation Cron] ${task.id} ${task.name}: AI result ready, pending review`
          : `[Automation Cron] ${task.id} ${task.name}: ${lastRunStatus}`
      );
    } catch (error: any) {
      const message = error?.message || "Automation execution failed";
      await finishRun(run.id, "failed", undefined, String(message));

      const { nextRunAt, nextStatus } = nextScheduleState(task);
      await client.query(
        `UPDATE automation_tasks SET
          next_run_at=$1, status=$2, last_run_at=NOW(),
          last_run_status='failed', updated_at=NOW()
         WHERE id=$3`,
        [nextRunAt, nextStatus, task.id]
      );

      console.error(`[Automation Cron] ${task.id} ${task.name}: failed`, error);
    }
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [
          ADVISORY_LOCK_NAMESPACE,
          automationId,
        ]);
      } catch (unlockError) {
        console.error("[Automation Cron] unlock failed:", unlockError);
      }
    }
    client.release();
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

export async function initAutomationScheduler() {
  await ensureAutomationTables();

  if (global.automationCronTask) {
    console.log("[Automation Cron] scheduler already initialized");
    return;
  }

  await scanDueAutomations();

  global.automationCronTask = cron.schedule("* * * * *", () => {
    void scanDueAutomations();
  });

  console.log("[Automation Cron] scheduler initialized (every minute)");
}
