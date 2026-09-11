/**
 * 邮件触发监听邮箱的标识与展示名处理。
 *
 * 历史格式 `mailbox:<id>`（以及作为哨兵的 `"system"`）已废弃：mailboxId 一律是
 * 指向 `automation_mailboxes` 的正整数。任何读取该标识的地方都不再做隐式回退，
 * 缺失或非法时抛出可识别的 MAILBOX_ID_REQUIRED，避免静默落到已下线的系统邮箱分支。
 *
 * 本模块是零依赖纯函数模块：服务端 store、邮箱记录的 API 映射（`mailboxes.ts`）
 * 与 node:test 用例共用它，因此不允许引入 `pg`、`lib/env` 等需要运行环境的依赖。
 */

export const MAILBOX_ID_REQUIRED = "MAILBOX_ID_REQUIRED";

/** 监听邮箱不存在，或不属于当前用户（模块 D.2 归属校验失败）。 */
export const MAILBOX_NOT_OWNED = "MAILBOX_NOT_OWNED";

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

/**
 * 由邮箱记录派生展示名（模块 D.3）。
 *
 * 展示名只能来自邮箱记录本身，客户端传上来的 `mailboxLabel` 一律忽略，避免伪造。
 * 规则与邮箱列表接口（`mailboxes.ts` 的 `mailboxRowToApi`）完全一致，因此
 * 「向导里选中的邮箱」与「自动化列表里显示的邮箱」必然是同一个字符串。
 */
export function mailboxLabelFromRow(row: { name?: unknown; email?: unknown } | null | undefined): string {
  const name = String(row?.name ?? "");
  const email = String(row?.email ?? "");
  return name && name !== email ? `${name} · ${email}` : email;
}
