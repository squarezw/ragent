import pool from "@/lib/db";

/**
 * 自动化数据表的**校验清单**，不是建表清单。
 *
 * 表结构由部署时执行的建表脚本建立——**真源是后端仓 ragent-service 的
 * `docker/db/automation.sql`**（执行命令见该文件头部），本仓 ragent-public 是公开仓、
 * 不保留它的副本，应用进程也不做任何 DDL。
 * 这个清单、那份建表脚本、以及代码里实际用到的表名，三者的一致性由
 * `test/automationSchemaFile.test.ts` 守住（拿不到后端仓检出时，涉及建表脚本的那几条会跳过）。
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

/**
 * 去重表的唯一键（后端仓 docker/db/automation.sql 里显式命名的那一条），
 * 与 claim 的 ON CONFLICT 目标同源。
 */
const EMAIL_CLAIM_CONSTRAINT = "automation_email_processed_once_per_automation";

/** 该唯一键的列，按建表语句的顺序写全。缺少 automation_id 就是本次改造要做的那件事没生效。 */
const EMAIL_CLAIM_COLUMNS = "(created_by_user_id, mailbox_id, message_key, automation_id)";

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
 * 表在 ≠ 结构对，所以查完表之后还查一次去重表的唯一键：只比表名的话，一个"十张表齐全、
 * 唯一键还是旧的三列"的库会照常通过，直到第一封来信才以 42P10 爆出来——正是本文件要提前到
 * 启动期的那类问题。
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
          "请先执行后端仓 ragent-service 的 docker/db/automation.sql（命令见该文件头部）。"
      );
    }

    // 表在 ≠ 结构对：去重表的唯一键就是本次改造（一封邮件命中的每条自动化各领一次）的开关，
    // 因此连列一起核。旧的（或被人改回三列的）唯一键下，claimAutomationEmailMessage 的
    // `ON CONFLICT (…, automation_id)` 找不到匹配的约束，PostgreSQL 对**每一次** claim 报
    // 42P10 —— 而十张表一张不少，只查表名拦不住它，故障于是推迟到第一封来信。
    // 约束名由建表/迁移语句显式指定（PostgreSQL 自动生成的名字会截断到 63 字节，不可依赖）。
    const { rows: claimConstraints } = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'automation_email_processed_messages'
          AND c.conname = 'automation_email_processed_once_per_automation'
          AND c.contype = 'u'`
    );

    // pg_get_constraintdef 会按 PostgreSQL 自己的排版重排，先折叠空白再比对列。
    const definition = claimConstraints[0]?.definition?.replace(/\s+/g, " ") ?? null;

    if (!definition?.includes(EMAIL_CLAIM_COLUMNS)) {
      throw new Error(
        "AUTOMATION_SCHEMA_MISSING: 数据库的 automation_email_processed_messages 上" +
          (definition
            ? `唯一约束 ${EMAIL_CLAIM_CONSTRAINT} 与预期不符（现为 ${definition}）。`
            : `缺少唯一约束 ${EMAIL_CLAIM_CONSTRAINT} ${EMAIL_CLAIM_COLUMNS}。`) +
          "这条约束是「一封邮件命中的每条自动化各领一次」的开关：它不对，claim 的" +
          " ON CONFLICT 就找不到匹配的约束，每次都以 42P10 失败，且要到第一封来信才暴露——" +
          "请执行后端仓 ragent-service 的 docker/db/automation.sql 迁移段（命令见该文件头部），" +
          "改完重启进程。"
      );
    }
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  return schemaReadyPromise;
}
