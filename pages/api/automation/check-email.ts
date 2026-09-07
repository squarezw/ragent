import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { logError } from "@/lib/logError";
import {
  getAutomationMailboxForUser,
  mailboxConnectionFromRow,
} from "@/lib/automation/mailboxes";
import { fetchMailboxUnread } from "@/lib/automation/mailbox-client";

function parseAfterUid(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || String(raw).trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const afterUid = parseAfterUid(req.query.after_uid);
  if (afterUid === null) return res.status(400).json({ error: "Invalid after_uid" });

  const mailboxIdRaw = Array.isArray(req.query.mailbox_id)
    ? req.query.mailbox_id[0]
    : req.query.mailbox_id;
  const mailboxId = mailboxIdRaw ? Number(mailboxIdRaw) : null;

  try {
    const authorization = req.headers.authorization;

    // 未指定 mailbox_id 时继续兼容原来的系统邮箱。
    if (!mailboxId) {
      const backendBaseUrl = (process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010").replace(/\/+$/, "");
      const params = new URLSearchParams();
      if (afterUid !== undefined) params.set("after_uid", String(afterUid));
      const url = `${backendBaseUrl}/api/v1/email/unread${params.toString() ? `?${params.toString()}` : ""}`;

      const response = await fetch(url, {
        method: "GET",
        headers: authorization ? { Authorization: authorization } : {},
      });
      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
      if (!response.ok) {
        return res.status(response.status).json({
          error: "Email check failed",
          detail: typeof data === "object" && data?.detail ? data.detail : String(data || `Backend returned ${response.status}`),
        });
      }
      return res.status(200).json(data ?? { success: true, latest_uid: 0, messages: [] });
    }

    if (!Number.isInteger(mailboxId) || Number(mailboxId) <= 0) {
      return res.status(400).json({ detail: "监听邮箱 ID 无效" });
    }

    const mailbox = await getAutomationMailboxForUser(userId, Number(mailboxId));
    if (!mailbox) return res.status(404).json({ detail: "监听邮箱不存在" });

    const data = await fetchMailboxUnread({
      authorization,
      afterUid: afterUid === undefined ? undefined : Number(afterUid),
      connection: mailboxConnectionFromRow(mailbox),
    });

    return res.status(200).json(data);
  } catch (error: any) {
    console.error("[Automation Check Email API] Error:", error);
    logError(error);
    return res.status(500).json({
      error: "Email check failed",
      detail: error?.message || "Unknown error",
    });
  }
}
