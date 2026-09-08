import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { deleteAutomationMailbox } from "@/lib/automation/mailboxes";

function parseId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });
  const mailboxId = parseId(req.query.id);
  if (!mailboxId) return res.status(400).json({ detail: "Invalid mailbox id" });

  if (req.method === "DELETE") {
    try {
      const result = await deleteAutomationMailbox(userId, mailboxId);
      if (!result.deleted && result.dependents.length > 0) {
        return res.status(409).json({
          detail: `该邮箱仍被 ${result.dependents.length} 个自动化使用，请先修改这些自动化的监听邮箱`,
          dependents: result.dependents,
        });
      }
      if (!result.deleted) return res.status(404).json({ detail: "邮箱不存在" });
      return res.status(200).json({ deleted: true });
    } catch (error) {
      console.error("[Automation Mailbox Delete API] error:", error);
      return res.status(500).json({ detail: "删除邮箱失败" });
    }
  }

  res.setHeader("Allow", ["DELETE"]);
  return res.status(405).json({ detail: "Method Not Allowed" });
}
