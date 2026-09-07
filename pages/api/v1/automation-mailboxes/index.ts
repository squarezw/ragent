import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  createAutomationMailbox,
  listAutomationMailboxes,
  mailboxRowToApi,
} from "@/lib/automation/mailboxes";
import { fetchMailboxUnread } from "@/lib/automation/mailbox-client";

function errorResponse(res: NextApiResponse, error: any) {
  const code = String(error?.message || "");
  const map: Record<string, string> = {
    MAILBOX_EMAIL_INVALID: "请输入正确的邮箱地址",
    MAILBOX_USERNAME_REQUIRED: "请填写邮箱登录账号",
    MAILBOX_PASSWORD_REQUIRED: "请填写邮箱授权码或密码",
    MAILBOX_IMAP_HOST_REQUIRED: "请填写 IMAP 服务器",
    MAILBOX_IMAP_PORT_INVALID: "IMAP 端口不正确",
    AUTOMATION_MAILBOX_SECRET_MISSING: "服务端尚未配置邮箱凭证加密密钥",
  };
  if (map[code]) return res.status(400).json({ detail: map[code] });
  console.error("[Automation Mailboxes API] error:", error);
  return res.status(500).json({ detail: code || "邮箱操作失败" });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const rows = await listAutomationMailboxes(userId);
      return res.status(200).json({ items: rows.map(mailboxRowToApi) });
    } catch (error: any) {
      return errorResponse(res, error);
    }
  }

  if (req.method === "POST") {
    const input = {
      name: typeof req.body?.name === "string" ? req.body.name : "",
      email: typeof req.body?.email === "string" ? req.body.email : "",
      username: typeof req.body?.username === "string" ? req.body.username : "",
      password: typeof req.body?.password === "string" ? req.body.password : "",
      imapHost: typeof req.body?.imapHost === "string" ? req.body.imapHost : "",
      imapPort: Number(req.body?.imapPort || 993),
      imapSecure: req.body?.imapSecure !== false,
      folder: typeof req.body?.folder === "string" ? req.body.folder : "INBOX",
    };

    try {
      // 保存前先真实连接一次，避免把不可用的账号写入“已连接邮箱”。
      await fetchMailboxUnread({
        authorization: req.headers.authorization,
        connection: {
          email: input.email,
          username: input.username || input.email,
          password: input.password,
          imapHost: input.imapHost,
          imapPort: input.imapPort,
          imapSecure: input.imapSecure,
          folder: input.folder,
        },
      });

      const row = await createAutomationMailbox(userId, input);
      return res.status(201).json(mailboxRowToApi(row));
    } catch (error: any) {
      const message = String(error?.message || "邮箱连接失败");
      if (
        message.includes("IMAP") ||
        message.includes("登录") ||
        message.includes("连接") ||
        message.includes("认证") ||
        message.includes("AUTHENTICATION")
      ) {
        return res.status(400).json({ detail: message });
      }
      return errorResponse(res, error);
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ detail: "Method Not Allowed" });
}
