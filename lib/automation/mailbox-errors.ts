/**
 * 邮箱接口的错误映射：错误码 → HTTP 状态 + 用户可读文案。
 *
 * 创建（POST）、编辑（PUT）、列表（GET）三个分支共用一份，避免同一种失败在不同端点
 * 返回不同的话术——这种漂移用户最先发现，而且最难复现。
 */
import type { NextApiResponse } from "next";

const MAILBOX_ERROR_MESSAGES: Record<string, string> = {
  MAILBOX_EMAIL_INVALID: "请输入正确的邮箱地址",
  MAILBOX_USERNAME_REQUIRED: "请填写邮箱登录账号",
  MAILBOX_PASSWORD_REQUIRED: "请填写邮箱授权码或密码",
  MAILBOX_IMAP_HOST_REQUIRED: "请填写 IMAP 服务器",
  MAILBOX_IMAP_PORT_INVALID: "IMAP 端口不正确",
  MAILBOX_CREDENTIAL_INVALID: "邮箱凭据已失效，请重新填写授权码或密码",
  AUTOMATION_MAILBOX_SECRET_MISSING: "服务端尚未配置邮箱凭证加密密钥",
};

/**
 * 上游 IMAP 失败沿用原文：它带回的是真实原因（主机、端口、认证），改写只会丢失信息。
 *
 * 匹配**大小写不敏感**：收信现在跑在本进程里，抛出来的是 Node 与 imapflow 的原文，
 * 大小写并不统一（`ECONNREFUSED` / `Authentication failed` / `Socket timeout`）。
 * 漏掉一种，用户看到的就是一句「邮箱操作失败」，而主机写错、授权码失效这些真实原因
 * 已经丢在路上——这正是「保存邮箱只报 500」那次故障的形状。
 */
const CONNECTION_ERROR_HINTS = [
  "imap",
  "登录",
  "连接",
  "认证",
  "authentication",
  // 网络层：Node 的系统错误码（连接被拒 / 超时 / 域名解析不了 / 地址不可达）
  "econnrefused",
  "econnreset",
  "etimedout",
  "ehostunreach",
  "enetunreach",
  "enotfound",
  "getaddrinfo",
  // imapflow 自己的文案
  "socket timeout",
  // TLS：自签名、过期、域名不匹配都是配置问题，不是我们这边的故障
  "certificate",
  "self-signed",
  "tls",
];

/** 邮箱地址在本用户下唯一（UNIQUE(created_by_user_id, email)）时的唯一约束冲突。 */
const UNIQUE_VIOLATION = "23505";

/**
 * 错误码 → 用户可读文案；不在表里的（通常是上游 IMAP 带回的真实原因）原样返回。
 *
 * 与 `mailboxApiError` 共用同一张表：**写进 `automation_mailboxes.last_error`、进而显示在
 * 抽屉「最后错误」与通知中心里的文案，必须与接口返回的是同一句话**。只映射接口那一侧的话，
 * 同一个故障会在两个地方说两种话——接口说「请重新填写授权码」，通知里却写着
 * `MAILBOX_CREDENTIAL_INVALID`（模块 E.1/E.2 的写入点因此必须先过这里）。
 */
export function mailboxErrorDisplayText(error: unknown): string {
  const code = String((error as { message?: unknown })?.message ?? "").trim();
  return MAILBOX_ERROR_MESSAGES[code] || code;
}

export function mailboxApiError(error: unknown): { status: number; detail: string } {
  const code = String((error as { message?: unknown })?.message ?? "");
  const known = MAILBOX_ERROR_MESSAGES[code];
  if (known) return { status: 400, detail: known };

  if ((error as { code?: unknown })?.code === UNIQUE_VIOLATION) {
    return {
      status: 409,
      detail: "该邮箱地址已用于你的另一条邮箱记录，请改用其它地址或直接编辑那一条",
    };
  }

  const normalizedCode = code.toLowerCase();
  if (CONNECTION_ERROR_HINTS.some((hint) => normalizedCode.includes(hint))) {
    return { status: 400, detail: code };
  }

  return { status: 500, detail: code || "邮箱操作失败" };
}

/** 直接把映射结果写成响应；只有 500 才打日志（4xx 是预期内的用户错误，不该刷错误日志）。 */
export function respondMailboxApiError(res: NextApiResponse, error: unknown) {
  const { status, detail } = mailboxApiError(error);
  if (status >= 500) console.error("[Automation Mailboxes API] error:", error);
  return res.status(status).json({ detail });
}
