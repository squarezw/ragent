/**
 * 邮件去重表的保留期（模块 E.4）。
 *
 * `automation_email_processed_messages` 每处理一封新邮件就写一行，没有删除路径就会无界增长。
 * 保留 30 天。
 *
 * 为什么 30 天足够，以及为什么删旧行不会与游标状态打架：一行去重记录的使命只是"这封邮件
 * 已被处理过，别再处理一次"，而它只需要活到该邮件的 UID 落到游标高水位以下为止——正常情况下
 * 调度器处理完这封邮件就立刻推进游标（`saveAutomationEmailMailboxCursor`），所以这个窗口只有
 * 几秒。30 天是留给"游标被 D.4 打回重来"这类事件的宽裕余量：重置后调度器先重建基线、
 * 不处理历史邮件，因此真正需要去重的仍然只有最新的一批邮件。反过来，`GREATEST` 保证游标
 * 高水位只前进，调度器不会回看早于基线的邮件，所以删掉 30 天前的去重行不会让历史邮件被
 * 重新处理（唯一能让游标倒退的是显式重置，而重置后会重新建立基线）。
 *
 * 零依赖纯函数模块：截止时刻在 JS 里算好再作为查询参数传入，因此"保留多少天"是可断言的
 * 行为，而不是埋在 `INTERVAL '30 days'` 字符串里对测试不可见。
 */

/** 去重表保留天数（spec §四 模块 E.4）。 */
export const EMAIL_PROCESSED_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 保留期截止时刻：`created_at` 早于它的去重行会被清理。 */
export function emailProcessedRetentionCutoff(
  now: Date,
  retentionDays: number = EMAIL_PROCESSED_RETENTION_DAYS
): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}
