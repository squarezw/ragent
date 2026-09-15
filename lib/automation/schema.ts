import pool from "@/lib/db";

/**
 * 自动化数据表的**校验清单**，不是建表清单。
 *
 * 表结构由部署时执行的 `db/automation.sql` 建立（命令见该文件头部），应用进程不做任何 DDL。
 * 这个清单、那份 SQL 文件、以及代码里实际用到的表名，三者的一致性由
 * `test/automationSchemaFile.test.ts` 守住。
 *
 * 单独成模块而不是挂在 `store.ts` 上：`mailboxes.ts` 需要同一套校验，而它被 `store.ts`
 * 反向依赖，直接 import 会成环。
 */
export const AUTOMATION_TABLES = [
  "automation_tasks",
  "automation_runs",
  "automation_run_review_history",
  "automation_run_actions",
  "automation_email_processed_messages",
  "automation_email_mailbox_cursors",
  "automation_email_rule_events",
  "automation_notification_preferences",
  "automation_notification_states",
  "automation_mailboxes",
] as const;

let schemaReadyPromise: Promise<void> | null = null;

/**
 * 断言自动化表已经就位（幂等；进程内只真正查一次，之后每次调用都是一个已 resolve 的 Promise）。
 *
 * **这里不建表。** 原因很直接：本函数在 30 多处 store 函数开头都会被调用，把它当建表入口，
 * 等于让应用进程长期握有 DDL 权限、并在每次冷启动时对生产库做一次结构写入——那是部署动作，
 * 不是运行时动作。
 *
 * 找不到表就抛错，且**把缺哪几张列出来**：这是唯一能同时覆盖"全新部署忘了导 SQL"与
 * "某张表被改名/删掉"两种情形的信号，比一句通用的 500 有用得多。
 *
 * 失败时重置缓存：数据库暂时连不上属于可恢复故障，下一次调用应当重试，而不是把进程
 * 永久钉在失败态（与改造前的语义一致）。
 */
export async function assertAutomationTablesReady() {
  if (schemaReadyPromise) return schemaReadyPromise;

  schemaReadyPromise = (async () => {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT candidate.name
         FROM unnest($1::text[]) AS candidate(name)
        WHERE to_regclass('public.' || candidate.name) IS NULL`,
      [[...AUTOMATION_TABLES]]
    );

    if (rows.length > 0) {
      const missing = rows.map((row) => row.name).join(", ");
      throw new Error(
        `AUTOMATION_SCHEMA_MISSING: 数据库缺少自动化数据表 ${missing}。` +
          "表结构由部署时的 SQL 脚本一次性建立，应用不会自行建表——" +
          "请先执行 db/automation.sql（命令见该文件头部）。"
      );
    }
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  return schemaReadyPromise;
}
