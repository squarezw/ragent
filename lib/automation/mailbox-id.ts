/**
 * 邮件触发监听邮箱的标识处理。
 *
 * 历史格式 `mailbox:<id>`（以及作为哨兵的 `"system"`）已废弃：mailboxId 一律是
 * 指向 `automation_mailboxes` 的正整数。任何读取该标识的地方都不再做隐式回退，
 * 缺失或非法时抛出可识别的 MAILBOX_ID_REQUIRED，避免静默落到已下线的系统邮箱分支。
 */

export const MAILBOX_ID_REQUIRED = "MAILBOX_ID_REQUIRED";

/** 归一化邮箱标识：仅接受正整数，其余（含遗留的 `mailbox:<id>`、`"system"`）返回 null。 */
export function normalizeMailboxId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** 读取邮箱标识：取不到合法值时抛错，而不是回退到 "system"。 */
export function requireMailboxId(value: unknown): number {
  const mailboxId = normalizeMailboxId(value);
  if (mailboxId === null) throw new Error(MAILBOX_ID_REQUIRED);
  return mailboxId;
}

/** 调度分组键（决定优先级竞争与去重范围）：同一用户同一监听邮箱为同一组。 */
export function mailboxGroupKey(userId: number, mailboxId: number): string {
  return `${userId}:${mailboxId}`;
}
