/**
 * 邮件触发监听邮箱的标识与展示名处理。
 *
 * 历史格式 `mailbox:<id>`（以及作为哨兵的 `"system"`）已废弃：mailboxId 一律是
 * 指向 `automation_mailboxes` 的正整数。任何读取该标识的地方都不再做隐式回退：缺失或
 * 非法抛 MAILBOX_ID_REQUIRED，恰为已下线的哨兵值抛 MAILBOX_SYSTEM_RETIRED，展示层
 * 则返回 null 由调用方显示「未配置」——都不再静默落到已下线的系统邮箱。
 *
 * 本模块是零依赖纯函数模块：服务端 store、邮箱记录的 API 映射（`mailboxes.ts`）
 * 与 node:test 用例共用它，因此不允许引入 `pg`、`lib/env` 等需要运行环境的依赖。
 */

export const MAILBOX_ID_REQUIRED = "MAILBOX_ID_REQUIRED";

/** 监听邮箱不存在，或不属于当前用户（模块 D.2 归属校验失败）。 */
export const MAILBOX_NOT_OWNED = "MAILBOX_NOT_OWNED";

/** 模块 A：提交的正是已下线的平台系统邮箱哨兵值，需要专门的用户提示。 */
export const MAILBOX_SYSTEM_RETIRED = "MAILBOX_SYSTEM_RETIRED";

/** 模块 A：监听邮箱展示名缺失（遗留行没有存储名）。 */
export const MAILBOX_LABEL_REQUIRED = "MAILBOX_LABEL_REQUIRED";

/** 已下线的系统邮箱哨兵值：`mailboxKey` 时代用它表示"平台共享监听邮箱"。 */
const RETIRED_SYSTEM_MAILBOX_KEY = "system";

/** 归一化邮箱标识：仅接受正整数，其余（含遗留的 `mailbox:<id>`、`"system"`）返回 null。 */
export function normalizeMailboxId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * 读取邮箱标识：取不到合法值时抛错，而不是回退到 "system"。
 *
 * 模块 A：取值恰为已下线的哨兵值 `"system"` 时抛出 MAILBOX_SYSTEM_RETIRED。它同样是非法
 * 标识，但需要单独识别——旧客户端仍会提交它，接口据此给出「系统邮箱已下线」的专门提示，
 * 而不是通用的"缺少监听邮箱"。正整数 id 不会与之冲突。
 */
export function requireMailboxId(value: unknown): number {
  const mailboxId = normalizeMailboxId(value);
  if (mailboxId === null) {
    if (typeof value === "string" && value.trim() === RETIRED_SYSTEM_MAILBOX_KEY) {
      throw new Error(MAILBOX_SYSTEM_RETIRED);
    }
    throw new Error(MAILBOX_ID_REQUIRED);
  }
  return mailboxId;
}

/**
 * 调度器读取监听邮箱展示名：缺失时抛错，没有已下线系统邮箱的兜底（模块 A）。
 *
 * 存储名在创建/更新时按邮箱记录派生（模块 D.3），因此正常数据必然有值；取不到说明该行是
 * 遗留或被改坏的数据。此时抛错比显示一个错误的邮箱名更好：调用方按"用户:邮箱"分组捕获，
 * 只影响这一组，其他邮箱与其他触发类型的自动化不受影响。
 */
export function requireMailboxLabel(value: unknown): string {
  const label = String(value ?? "").trim();
  if (!label) throw new Error(MAILBOX_LABEL_REQUIRED);
  return label;
}

/**
 * 展示层读取监听邮箱展示名：缺失时返回 null，由调用方显示「未配置」，不回退到系统邮箱。
 *
 * 与 `requireMailboxLabel` 只差在失败方式：列表接口与运行详情不能因为一行遗留数据的展示名
 * 缺失就整体报错（那会连带影响同一响应里其他触发类型的自动化）。
 */
export function storedMailboxLabel(value: unknown): string | null {
  const label = String(value ?? "").trim();
  return label || null;
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

/*
 * 以下为向导端（"use client"）的选择与展示派生逻辑（模块 B / D.7）。
 * 放在本模块是因为它们判断的是同一件事——邮箱标识与展示名，且必须与上面的
 * 分组键、邮箱列表接口（mailboxes.ts 的 mailboxRowToApi）保持一致，不能各写一份。
 */

/** 下拉中「＋ 配置新邮箱…」的哨兵值：mailboxId 恒为正整数，不会与之冲突。 */
export const MAILBOX_NEW_OPTION = "new";

/** 下拉的显示值：选中已保存邮箱时是它的 id，配置新邮箱时是哨兵值。 */
export function mailboxSelectValue(mailboxId: number | null, formOpen: boolean): string {
  if (formOpen) return MAILBOX_NEW_OPTION;
  const id = normalizeMailboxId(mailboxId);
  return id === null ? MAILBOX_NEW_OPTION : String(id);
}

/** 邮箱列表接口（`mailboxes.ts` 的 mailboxRowToApi）返回项的可见字段。 */
export type MailboxOption = {
  id: number;
  label?: string;
  name?: string;
  email?: string;
  username?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  folder?: string;
  status?: string;
};

/** 参与邮件触发的自动化最小视图（page.tsx 的 Automation 是它的超集）。 */
export type MailboxScopedAutomation = {
  id: number;
  trigger: string;
  status: string;
  mailboxId?: number | null;
};

/** 下拉项展示名：优先用接口给的 label，缺失时按与接口一致的规则派生。 */
export function mailboxOptionLabel(option: MailboxOption): string {
  const label = String(option?.label ?? "").trim();
  return label || mailboxLabelFromRow(option);
}

/**
 * 邮箱名单加载完成后的**默认**选择：只有还没有选择时才用名单里的第一条。
 *
 * 已有选择一律原样保留，**即使它在名单里查不到**——把查不到的选择静默换成名单第一条，
 * 会让一次普通保存把自动化改绑到另一个收件箱（监听错邮箱、可能用错账号回信）。
 * 查不到的选择由 `isMailboxSelectionUnresolved` 判定并要求用户重新选择。
 */

export function defaultMailboxSelection(
  mailboxId: number | null,
  mailboxes: readonly MailboxOption[],
): number | null {
  const selected = normalizeMailboxId(mailboxId);
  if (selected !== null) return selected;
  return normalizeMailboxId(mailboxes[0]?.id) ?? null;
}

/**
 * 有选择、名单也加载完了，但名单里没有它：遗留行、邮箱已被删除，或名单拉取失败。
 *
 * 名单尚未加载完时一律返回 false——那时"查不到"只说明数据还没到，不能据此判定失败，
 * 否则向导会在加载窗口里无故展开表单。判定为 true 时调用方必须让用户重新选择，
 * 而不是替他选一个。
 */
export function isMailboxSelectionUnresolved(
  mailboxId: number | null,
  mailboxes: readonly MailboxOption[],
  mailboxesLoaded: boolean,
): boolean {
  if (!mailboxesLoaded) return false;
  const selected = normalizeMailboxId(mailboxId);
  if (selected === null) return false;
  return !mailboxes.some((option) => normalizeMailboxId(option.id) === selected);
}

/**
 * D.7：与当前选择监听同一邮箱、同属邮件触发且正在运行的其他自动化。
 *
 * 没有选中邮箱时（含"正在配置新邮箱"）返回空候选——此时不存在可比较的分组。
 * `mailboxId` 缺失的遗留行（旧字符串键）不属于任何分组，因此不会被误判为冲突。
 * 与 `mailboxGroupKey` 的范围一致：只有同一 `userId:mailboxId` 才做优先级竞争。
 */
export function selectMailboxScopedAutomations<T extends MailboxScopedAutomation>(
  items: readonly T[],
  options: { mailboxId: number | null; excludeId?: number | null },
): T[] {
  const mailboxId = normalizeMailboxId(options.mailboxId);
  if (mailboxId === null) return [];

  return items.filter(
    (item) =>
      item.id !== options.excludeId &&
      item.trigger === "邮件触发" &&
      item.status === "running" &&
      normalizeMailboxId(item.mailboxId) === mailboxId,
  );
}

/**
 * 自动化列表 / 运行详情要显示的监听邮箱名。
 *
 * 返回 null 表示该自动化没有可解析的监听邮箱（遗留行，或名单里查不到且自身也没有
 * 存储名）：调用方据此给出「未配置」提示，而不是回退到已下线的"系统邮箱"。
 * 优先按 id 现查名单，邮箱改名后展示名跟着更新；查不到时退回服务端派生的存储名。
 */
export function automationMailboxLabel(
  item: { mailboxId?: number | null; mailboxLabel?: string },
  mailboxes: readonly MailboxOption[],
): string | null {
  const mailboxId = normalizeMailboxId(item?.mailboxId);
  if (mailboxId === null) return null;

  const matched = mailboxes.find((option) => normalizeMailboxId(option.id) === mailboxId);
  if (matched) return mailboxOptionLabel(matched);

  const stored = String(item?.mailboxLabel ?? "").trim();
  return stored || null;
}
