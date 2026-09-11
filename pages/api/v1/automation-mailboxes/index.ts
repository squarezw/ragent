import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { respondMailboxApiError } from "@/lib/automation/mailbox-errors";
import {
  createAutomationMailbox,
  listAutomationMailboxes,
  mailboxRowToApi,
} from "@/lib/automation/mailboxes";
import { fetchMailboxUnread } from "@/lib/automation/mailbox-client";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const rows = await listAutomationMailboxes(userId);
      return res.status(200).json({ items: rows.map(mailboxRowToApi) });
    } catch (error) {
      return respondMailboxApiError(res, error);
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
    } catch (error) {
      // 连接类失败沿用上游原文（见 mailbox-errors.ts），其余按错误码映射。
      return respondMailboxApiError(res, error);
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ detail: "Method Not Allowed" });
}
