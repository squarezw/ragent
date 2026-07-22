import cron, { type ScheduledTask } from "node-cron";
import pool from "@/lib/db";
import {
  generateDailySummary,
  generateWeeklySummary,
} from "@/lib/subscription-agent/generate-summary";

// Store all active cron tasks: appId -> ScheduledTask
const activeTasks = new Map<number, ScheduledTask>();

/**
 * Initialize: Load all enabled scheduled Subscription apps from database and create cron tasks
 */
export async function initScheduler() {
  try {
    const result = await pool.query(`
      SELECT id, name, settings
      FROM apps
      WHERE app_type = 'Subscription'
        AND settings->'schedule'->>'enabled' = 'true'
    `);

    for (const app of result.rows) {
      scheduleApp(app.id, app.settings);
    }
    console.log(`[Cron] Initialized ${result.rows.length} scheduled tasks`);
  } catch (error) {
    console.error("[Cron] Failed to initialize scheduler:", error);
  }
}

/**
 * Create cron task for specified app
 */
export function scheduleApp(appId: number, settings: any) {
  // Remove old task first
  unscheduleApp(appId);

  const { schedule } = settings;
  if (!schedule?.enabled || !schedule?.time) return;

  const [hour, minute] = schedule.time.split(":");
  const cronExpression = `${minute} ${hour} * * *`; // Execute at specified time every day

  const task = cron.schedule(
    cronExpression,
    async () => {
      await executeReport(appId, settings);
    },
    {
      timezone: schedule.timezone || "Asia/Shanghai",
    }
  );

  activeTasks.set(appId, task);
  console.log(
    `[Cron] Scheduled app ${appId} at ${schedule.time} (${schedule.timezone || "Asia/Shanghai"})`
  );
}

/**
 * Remove cron task for specified app
 */
export function unscheduleApp(appId: number) {
  const task = activeTasks.get(appId);
  if (task) {
    task.stop();
    activeTasks.delete(appId);
    console.log(`[Cron] Unscheduled app ${appId}`);
  }
}

/**
 * Execute report generation (directly call function, no HTTP)
 */
async function executeReport(appId: number, settings: any) {
  const { stream_feed_ids, topic, webhook_url, schedule } = settings;
  const today = new Date().toISOString().split("T")[0];

  try {
    // Check if already executed today (prevent duplicates)
    const check = await pool.query(
      `SELECT settings->'schedule'->>'last_run_date' as last_run FROM apps WHERE id = $1`,
      [appId]
    );
    if (check.rows[0]?.last_run === today) {
      console.log(`[Cron] App ${appId} already ran today, skipping`);
      return;
    }

    // Directly call the encapsulated function
    const params = { feedIds: stream_feed_ids, topic, webhook_url };
    if (schedule.report_type === "weekly") {
      await generateWeeklySummary(params);
    } else {
      await generateDailySummary(params);
    }

    // Update execution status
    await pool.query(
      `
      UPDATE apps
      SET settings = jsonb_set(
        jsonb_set(settings, '{schedule,last_run_date}', $1::jsonb),
        '{schedule,last_run_status}', $2::jsonb
      )
      WHERE id = $3
    `,
      [JSON.stringify(today), JSON.stringify("success"), appId]
    );

    console.log(`[Cron] App ${appId} report generated: success`);
  } catch (error) {
    // Update failure status
    await pool.query(
      `
      UPDATE apps
      SET settings = jsonb_set(
        jsonb_set(settings, '{schedule,last_run_date}', $1::jsonb),
        '{schedule,last_run_status}', $2::jsonb
      )
      WHERE id = $3
    `,
      [JSON.stringify(today), JSON.stringify("failed"), appId]
    );
    console.error(`[Cron] App ${appId} failed:`, error);
  }
}

/**
 * Sync cron task when app settings change
 * Call this after app update to sync the cron task
 */
export function syncAppSchedule(appId: number, appType: string, settings: any) {
  if (appType !== "Subscription") {
    return;
  }

  if (settings?.schedule?.enabled) {
    scheduleApp(appId, settings);
  } else {
    unscheduleApp(appId);
  }
}
