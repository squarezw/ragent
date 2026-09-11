/**
 * 监听邮箱的健康状态（模块 E.1 / E.2）：连接失败如何记录、如何变成一条用户可见的提醒。
 *
 * 为什么单独成模块：`mailboxes.ts`（写状态）与 `store.ts`（派生提醒）都依赖 `lib/db`，
 * 测试进程不连数据库、也解析不了 `@/` 别名，而「提醒的 eventKey 到底长什么样」是前端
 * 依赖的契约（页面按 eventKey 去重 toast，见 `page.tsx` 的 toastedNotificationKeysRef）。
 * 与 `mailbox-id.ts`、`mailbox-credentials.ts` 同一手法：零依赖纯函数模块，可直接 import。
 *
 * 展示名（label）由调用方按 `mailboxLabelFromRow` 派生后传入，本模块不重复实现那套规则——
 * 「同一个邮箱在哪都叫同一个名字」靠的是只有一份派生逻辑。
 */

/** 连接失败提醒的 eventKey 前缀。 */
export const MAILBOX_ERROR_EVENT_KEY_PREFIX = "mailbox-error:";

/**
 * 连接失败提醒的 eventKey：**固定为 `mailbox-error:<mailboxId>`，不含时间戳**。
 *
 * 这是有意的，且是承重的：一个邮箱的失败状态只对应**一条**稳定提醒。因此
 * - 邮箱没恢复时，反复失败不会不断产生新提醒（页面按 eventKey 去重，不会重复弹窗）；
 * - 邮箱恢复后（status 不再是 error）提醒自动消失，不需要任何"已解决"状态或去抖逻辑。
 *
 * 加上时间戳（"每次失败一条"）会同时破坏这两条性质，所以本函数刻意不接受任何时间参数。
 */
export function mailboxErrorEventKey(mailboxId: number): string {
  return `${MAILBOX_ERROR_EVENT_KEY_PREFIX}${mailboxId}`;
}

/** 落库的 `last_error` 长度上限：上游报错可能很长，存储必须有界。 */
export const MAILBOX_ERROR_MAX_LENGTH = 500;
/** 提醒里展示的错误长度：与 store.ts 的 clipNotificationError 同一尺度，列表里一行放得下。 */
const NOTIFICATION_ERROR_MAX_LENGTH = 120;

/** 归一化错误原文：去空白、截断；取不到内容时返回空串（由调用方决定兜底文案）。 */
export function mailboxErrorText(
  value: unknown,
  maxLength: number = MAILBOX_ERROR_MAX_LENGTH
): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** 派生提醒所需的最小行视图：调用方从 `automation_mailboxes` 取行后映射成本形状。 */
export type MailboxErrorRow = {
  mailboxId: number;
  /** 展示名，由调用方按 `mailboxLabelFromRow` 派生。 */
  label?: string;
  error?: string | null;
  errorAt?: string | Date | null;
};

/**
 * 与 `store.ts` 的 `AutomationNotificationItem` 结构一致（kind 复用既有的 `email_failed`）。
 * 本模块不 import 那个类型：它住在 `store.ts` 里，而 `store.ts` 依赖 `lib/db`。
 */
export type MailboxErrorNotificationItem = {
  eventKey: string;
  kind: "email_failed";
  level: "strong";
  title: string;
  message: string;
  automationId: null;
  runId: number;
  createdAt: string;
  read: false;
};

/**
 * 模块 E.2：把 `status='error'` 的邮箱行派生为提醒条目。
 *
 * 调用方只传当前处于 error 的行（SQL 侧过滤），因此"邮箱恢复后提醒消失"是**结构性**的：
 * 恢复即不再是 error 行，就再也派生不出条目，无需额外的状态清理。
 *
 * `runId` 恒为 0：连接失败发生在建 Run 之前，没有对应的运行记录——前端据此不会打开
 * 运行详情（`drawerRun` 查不到就什么都不渲染），而不是跳到一个不存在的运行上。
 * 同理 `automationId` 为 null：一条邮箱管道可能被多个自动化共用。
 */
export function mailboxErrorNotificationItems(
  rows: readonly MailboxErrorRow[],
  now: Date = new Date()
): MailboxErrorNotificationItem[] {
  return rows
    .filter((row) => Number.isInteger(row?.mailboxId) && Number(row.mailboxId) > 0)
    .map((row) => {
      const mailboxId = Number(row.mailboxId);
      const label = String(row.label ?? "").trim() || `邮箱 ${mailboxId}`;
      const error = mailboxErrorText(row.error, NOTIFICATION_ERROR_MAX_LENGTH);
      const errorAt = row.errorAt ? new Date(row.errorAt) : null;
      const createdAt =
        errorAt && !Number.isNaN(errorAt.getTime()) ? errorAt : new Date(now.getTime());

      return {
        eventKey: mailboxErrorEventKey(mailboxId),
        kind: "email_failed" as const,
        level: "strong" as const,
        title: `【失败】${label} 连接失败`,
        message: error
          ? `无法连接监听邮箱：${error}`
          : "无法连接监听邮箱，请在邮箱管理中检查服务器与授权码。",
        automationId: null,
        runId: 0,
        createdAt: createdAt.toISOString(),
        read: false as const,
      };
    });
}
