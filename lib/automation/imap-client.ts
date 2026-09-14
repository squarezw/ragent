/**
 * IMAP 收信：本进程内实现（不再调 ragent-service 的 `/api/v1/email/unread-config`）。
 *
 * 那个端点只以临时补丁脚本的形式存在过、从未进入部署镜像，于是每次保存邮箱与每 10 秒一次的
 * 轮询都 404，错误文案里没有任何关键词、落不到 400 分支，被兜底成 500。收信因此搬进 ragent
 * 进程——`instrumentation.ts` 本来就在 Next 进程内跑调度器（`ENABLE_CRON=true`），不是新模式。
 *
 * 这是 Python 参考实现（`adce8b1:patch_backend_multi_mailbox.py`，含
 * `patch_backend_mail_batch.py` 的批处理修复）的移植，不是重新设计。三处反直觉的地方：
 *
 * 1. **只读打开文件夹**（`readOnly: true`），绝不改动用户邮箱的已读状态。处理与否由我们
 *    自己的游标与去重表决定，与 `\Seen` 无关——也正因如此，用户在客户端读过的信仍会被处理。
 * 2. **`latest_uid` 是「文件夹当前最大 UID」**，在游标判断之前就取好；它是调用方建基线的
 *    依据，与「本批取到了哪些」无关（首次运行甚至一封都不取）。
 * 3. **一批取「游标之后最早的 20 封」**，不是最新 20 封。游标逐封推进，取最新一批会让它
 *    一次跳过中间所有邮件，而这些邮件再也不会被读到——静默丢信。
 *
 * 纯逻辑（UID 截取、正文与附件名提取、字段规范化）都抽成了可直接喂参数的函数，
 * 单测 `test/imapClient.test.ts` 不连网也不连库。
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

/** 连接超时：与参考实现的 `timeout=15` 对齐（连接、问候、以及无响应等待都是这个量级）。 */
export const IMAP_TIMEOUT_MS = 15_000;

/** 单批最多读取的邮件数。积压更多时由下一次轮询继续，游标只在真正处理过的邮件上前进。 */
export const IMAP_MESSAGE_BATCH_SIZE = 20;

export type MailboxConnection = {
  email?: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  folder: string;
};

/** 单封邮件：调用方（调度器）依赖的 8 个字段恒存在。 */
export type MailboxUnreadMessage = {
  uid: number;
  message_id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  attachments: string[];
};

export type MailboxUnreadResult = {
  success: boolean;
  latest_uid: number;
  messages: MailboxUnreadMessage[];
};

/** 本地纯函数取值时用到的解析结果视图：`mailparser` 的 `ParsedMail` 是它的超集。 */
export type ParsedMailView = {
  text?: unknown;
  html?: unknown;
  subject?: unknown;
  messageId?: unknown;
  from?: unknown;
  to?: unknown;
  attachments?: unknown;
  headerLines?: unknown;
};

/** 文件夹 UID 全集 → 「当前最大 UID」；空文件夹为 0。 */
export function latestUidFrom(uids: readonly number[]): number {
  let latest = 0;
  for (const uid of uids) {
    const value = Number(uid);
    if (Number.isInteger(value) && value > latest) latest = value;
  }
  return latest;
}

/**
 * 本轮该取哪些邮件，以及该回报的 `latest_uid`。
 *
 * 顺序是承重的：`latestUid` 先算（它来自文件夹的 UID 全集），`afterUid` 只决定**本批**取哪些。
 * 游标尚未建立（不传 / null / 非整数）时只回报基线、一封不取——调用方拿它写 `initialized`
 * 游标，下次轮询才开始真正收信。此时若返回 0（或返回本批的最大值），下一次就会把历史邮件
 * 重放一遍。
 */
export function planMailboxFetch(
  uids: readonly number[],
  afterUid?: number | null
): { latestUid: number; targetUids: number[] } {
  const latestUid = latestUidFrom(uids);

  if (!Number.isInteger(afterUid)) return { latestUid, targetUids: [] };

  const cursor = Number(afterUid);
  const targetUids = uids
    .map(Number)
    .filter((uid) => Number.isInteger(uid) && uid > cursor)
    .sort((left, right) => left - right)
    .slice(0, IMAP_MESSAGE_BATCH_SIZE);

  return { latestUid, targetUids };
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 正文：纯文本优先，HTML 兜底，都没有则空串（不是 undefined）。
 *
 * 单一取值来源，因此不会有「HTML-only 邮件返回带标签的源码、`开头是`/`等于` 规则拿标签
 * 去匹配」之外的第二套语义。前提是解析时传了 `skipHtmlToText`：默认行为会把 HTML
 * 「翻译」成一段纯文本塞进 `text`，那样就再也分不清「本来有纯文本」与「只有 HTML」。
 */
export function extractBody(parsed: ParsedMailView): string {
  const text = textValue(parsed?.text).trim();
  if (text) return text;
  return textValue(parsed?.html).trim();
}

/**
 * 附件名：**任何带 filename 的 part 都算**（inline 也算），只取解码后的文件名。
 *
 * `mailparser` 会把没有 filename 的内嵌图片（只有 Content-ID 的）也放进 `attachments`，
 * 而参考实现取的是 `part.get_filename()`——所以这里必须按 filename 过滤，否则会多报附件。
 */
export function extractAttachmentNames(parsed: ParsedMailView): string[] {
  const attachments = Array.isArray(parsed?.attachments) ? parsed.attachments : [];
  const names: string[] = [];

  for (const attachment of attachments) {
    const filename = textValue((attachment as { filename?: unknown })?.filename);
    if (filename.trim()) names.push(filename);
  }

  return names;
}

/** 原始头部文本（`mailparser` 的 `headerLines` 是 `{key, line}` 列表，key 已小写）。 */
export function rawHeaderValue(headerLines: unknown, key: string): string {
  if (!Array.isArray(headerLines)) return "";

  const wanted = key.toLowerCase();
  for (const entry of headerLines) {
    const record = entry as { key?: unknown; line?: unknown };
    if (textValue(record?.key).toLowerCase() !== wanted) continue;

    const line = textValue(record?.line);
    const colon = line.indexOf(":");
    return (colon >= 0 ? line.slice(colon + 1) : line).trim();
  }

  return "";
}

/** 地址头部取可读文本（`"张三" <a@corp.com>`）；同一头部出现多次时 `mailparser` 给的是数组。 */
function addressText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => addressText(item))
      .filter(Boolean)
      .join(", ");
  }
  return textValue((value as { text?: unknown })?.text);
}

/** 解析结果 → `InboxMessage`：8 个字段恒存在，缺失的一律是空串而非 undefined。 */
export function toInboxMessage(uid: number, parsed: ParsedMailView): MailboxUnreadMessage {
  return {
    uid,
    message_id: textValue(parsed?.messageId),
    from: addressText(parsed?.from),
    to: addressText(parsed?.to),
    subject: textValue(parsed?.subject),
    // 与参考实现一致：用 `Date:` 头部原文（不是重新格式化的时间），拿不到就是空串。
    date: rawHeaderValue(parsed?.headerLines, "date"),
    body: extractBody(parsed),
    attachments: extractAttachmentNames(parsed),
  };
}

/**
 * 原始报文 → 单封邮件。
 *
 * `keepCidLinks` 让 HTML 保持原样（默认会把内嵌图片的 cid 链接改写成 data URI）；
 * 与 `skipHtmlToText` 合起来，`text`/`html` 才与参考实现的取法一一对应。
 */
export async function parseInboxMessage(
  uid: number,
  source: Buffer | string
): Promise<MailboxUnreadMessage> {
  const parsed = await simpleParser(source, { skipHtmlToText: true, keepCidLinks: true });
  return toInboxMessage(uid, parsed);
}

/** 失败文案统一加前缀：映射层靠 `IMAP` 这个词把它归到连接类失败（400），而不是兜底成 500。 */
export function imapFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return `IMAP 收件失败: ${detail}`;
}

function requireConnectionField(value: string, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`IMAP 连接参数不完整：缺少${label}`);
  return text;
}

/**
 * 收一封信箱的未读（严格说是「游标之后的」）邮件。
 *
 * 契约见 `pages/api/v1/email/unread-config.ts` 与调度器的 `fetchConfiguredMailboxUnread`：
 * 不传 `afterUid` 表示游标尚未建立，此时只回报 `latest_uid`、`messages` 为空。
 */
export async function fetchMailboxUnread(params: {
  afterUid?: number | null;
  connection: MailboxConnection;
}): Promise<MailboxUnreadResult> {
  const { connection } = params;
  const host = requireConnectionField(connection.imapHost, "IMAP 服务器");
  const username = requireConnectionField(connection.username, "登录账号");
  const password = requireConnectionField(connection.password, "授权码或密码");
  const folder = String(connection.folder || "").trim() || "INBOX";
  const port = Number.isInteger(connection.imapPort) ? Number(connection.imapPort) : 993;

  const client = new ImapFlow({
    host,
    port,
    secure: connection.imapSecure !== false,
    auth: { user: username, pass: password },
    // 短连接：连上、读一批、退出。不监听新邮件，因此不需要 IDLE。
    disableAutoIdle: true,
    logger: false,
    connectionTimeout: IMAP_TIMEOUT_MS,
    greetingTimeout: IMAP_TIMEOUT_MS,
    socketTimeout: IMAP_TIMEOUT_MS,
  });

  try {
    await client.connect();

    // 只读打开：绝不给用户的邮件打上已读标记（处理与否只由游标与去重表决定）。
    await client.mailboxOpen(folder, { readOnly: true });

    const found = await client.search({ all: true }, { uid: true });
    const uids = Array.isArray(found) ? found.map(Number) : [];
    const { latestUid, targetUids } = planMailboxFetch(uids, params.afterUid);

    const messages: MailboxUnreadMessage[] = [];
    for (const uid of targetUids) {
      const fetched = await client.fetchOne(String(uid), { source: true }, { uid: true });
      const source = fetched ? fetched.source : undefined;
      if (!source) continue;

      messages.push(await parseInboxMessage(uid, source));
    }

    return { success: true, latest_uid: latestUid, messages };
  } catch (error) {
    throw new Error(imapFailureMessage(error), { cause: error });
  } finally {
    try {
      await client.logout();
    } catch {
      // 连接可能已经断了：logout 失败无所谓，原始错误在上面那个 catch 里已经成形。
    }
  }
}
