/**
 * 监听邮箱配置的归一化校验（创建）与更新合并（编辑）。
 *
 * 创建（POST）与编辑（PUT）必须共用同一套字段规则——各写一份必然漂移，而漂移的后果是
 * 「向导里能存、编辑器里存不了」这类无解工单。另外编辑路径的密码语义是本模块存在的
 * 主要原因：**密码留空表示保留原凭据**，把已存密码覆盖成空串会让所有绑定该邮箱的
 * 自动化在下次轮询时静默失败，因此它必须住在零依赖模块里、能被 node:test 直接断言
 * （`mailboxes.ts` 依赖 `lib/db`，测试进程连不了数据库）。
 */

/** 邮箱配置的原始入参：创建时 email/password/imapHost 必填，编辑时全部可选。 */
export type MailboxConfigInput = {
  name?: string;
  email?: string;
  username?: string;
  password?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  folder?: string;
};

/** 归一化后的邮箱配置：字段齐备且已通过校验，可直接落库或建连接。 */
export type MailboxConfig = {
  name: string;
  email: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  folder: string;
};

function normalizedEmail(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizedHost(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizedFolder(value: unknown) {
  const folder = String(value ?? "").trim();
  return folder || "INBOX";
}

/**
 * 归一化并校验邮箱配置。非法取值抛可识别的错误码（接口层翻译成文案），
 * 不做任何静默兜底：写进库的必须是用户真正填的那套配置。
 */
export function normalizeMailboxConfig(input: MailboxConfigInput): MailboxConfig {
  const email = normalizedEmail(input?.email);
  const username = String(input?.username ?? "").trim() || email;
  const password = String(input?.password ?? "");
  const imapHost = normalizedHost(input?.imapHost);
  const imapPort =
    input?.imapPort === undefined || input?.imapPort === null ? 993 : Number(input.imapPort);
  const imapSecure = input?.imapSecure !== false;
  const folder = normalizedFolder(input?.folder);
  const name = String(input?.name ?? "").trim() || email;

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("MAILBOX_EMAIL_INVALID");
  if (!username) throw new Error("MAILBOX_USERNAME_REQUIRED");
  if (!password) throw new Error("MAILBOX_PASSWORD_REQUIRED");
  if (!imapHost) throw new Error("MAILBOX_IMAP_HOST_REQUIRED");
  if (!Number.isInteger(imapPort) || imapPort <= 0 || imapPort > 65535) {
    throw new Error("MAILBOX_IMAP_PORT_INVALID");
  }

  return { name, email, username, password, imapHost, imapPort, imapSecure, folder };
}

export type MailboxUpdateResolution = {
  /** 合并后的完整配置（含生效的密码），可直接用于落库与建立 IMAP 连接。 */
  config: MailboxConfig;
  /** 模块 D.4：连接身份（主机 / 账号 / 文件夹）变了才需要重置游标。 */
  cursorResetRequired: boolean;
};

/** PUT 请求体里允许出现的字段。 */
const UPDATE_BODY_TEXT_FIELDS = [
  "name",
  "email",
  "username",
  "password",
  "imapHost",
  "folder",
] as const;

/**
 * 从编辑（PUT）请求体里读出**真正出现过**的字段。
 *
 * 与创建路径相反：创建时缺失字段各有默认值，编辑时缺失字段表示"保留原值"。因此这里
 * 不做任何补齐——尤其不能把缺失的 `password` 补成空串。当前"未提供"与"提供了空串"
 * 都表示"不修改既有凭据"，但两者必须一路可区分：一旦中间层把它们抹平成同一个值，
 * 未来的语义分叉（例如允许显式清空）就没有任何判断依据了。
 */
export function mailboxUpdateInputFromBody(body: unknown): MailboxConfigInput {
  const source: Record<string, unknown> =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const input: MailboxConfigInput = {};

  for (const field of UPDATE_BODY_TEXT_FIELDS) {
    const value = source[field];
    if (typeof value === "string") input[field] = value;
  }

  // 端口：数字与数字串都收；空串/null/undefined 视为"没提供"，保持原端口。
  const imapPort = source.imapPort;
  if (imapPort !== undefined && imapPort !== null && imapPort !== "") {
    input.imapPort = Number(imapPort);
  }
  if (typeof source.imapSecure === "boolean") input.imapSecure = source.imapSecure;

  return input;
}

/**
 * 编辑语义：把请求里**出现过的**字段覆盖到既有配置上，未出现的字段保留原值。
 *
 * 密码的两条空值路径——未提供（undefined）与提供了空串（""）——都表示"不修改"：
 * 邮箱凭据不允许为空，因此空串不可能是一个有效的"新密码"，只能理解为"别动它"。
 * 两者的区别在于调用方必须真的区分它们：`input.password || existing.password` 这类
 * 写法一旦被改成 `input.password ?? existing.password`，空串就会覆盖掉存储的凭据。
 */
export function resolveMailboxUpdate(
  existing: MailboxConfig,
  input: MailboxConfigInput
): MailboxUpdateResolution {
  const provided = (value: unknown) => value !== undefined && value !== null;
  const password = String(input?.password ?? "");

  const config = normalizeMailboxConfig({
    name: provided(input?.name) ? input.name : existing.name,
    email: provided(input?.email) ? input.email : existing.email,
    username: provided(input?.username) ? input.username : existing.username,
    password: password === "" ? existing.password : password,
    imapHost: provided(input?.imapHost) ? input.imapHost : existing.imapHost,
    imapPort: provided(input?.imapPort) ? input.imapPort : existing.imapPort,
    imapSecure: provided(input?.imapSecure) ? input.imapSecure : existing.imapSecure,
    folder: provided(input?.folder) ? input.folder : existing.folder,
  });

  return { config, cursorResetRequired: mailboxIdentityChanged(existing, config) };
}

/**
 * 模块 D.4：UID 基线由 IMAP 主机 + 账号 + 文件夹共同决定，三者任一变化都意味着
 * "这就是另一个收件箱了"，必须把游标打回未初始化；否则调度器会拿旧基线去比新邮箱的
 * UID，要么漏邮件、要么重复处理。
 *
 * 纯密码、端口、加密方式、名称的变化不移动 UID 基线，因此不重置：重置会让下一次轮询
 * 重新取一遍最新 UID 作基线，白丢掉这一段窗口里的邮件。
 *
 * 两侧都按写入时的规则归一化再比较：主机大小写、文件夹首尾空格、空文件夹等于 INBOX
 * 都不算变更，避免"只改了个大小写就重置"。
 */
function mailboxIdentityChanged(existing: MailboxConfig, next: MailboxConfig): boolean {
  return (
    normalizedHost(existing?.imapHost) !== normalizedHost(next?.imapHost) ||
    String(existing?.username ?? "").trim() !== String(next?.username ?? "").trim() ||
    normalizedFolder(existing?.folder) !== normalizedFolder(next?.folder)
  );
}
