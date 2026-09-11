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

/** 上游 IMAP 失败沿用原文：它带回的是真实原因（主机、端口、认证），改写只会丢失信息。 */
const CONNECTION_ERROR_HINTS = ["IMAP", "登录", "连接", "认证", "AUTHENTICATION"];

/** 邮箱地址在本用户下唯一（UNIQUE(created_by_user_id, email)）时的唯一约束冲突。 */
const UNIQUE_VIOLATION = "23505";

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

  if (CONNECTION_ERROR_HINTS.some((hint) => code.includes(hint))) {
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
