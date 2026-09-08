import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { claimAutomationEmailMessage, getAutomation } from "@/lib/automation/store";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ detail: "Method Not Allowed" });
  }

  const automationId = Number(req.body?.automationId);
  const mailboxKey = String(req.body?.mailboxKey || "system").trim() || "system";
  const messageKey = String(req.body?.messageKey || "").trim();

  if (!Number.isInteger(automationId) || automationId <= 0) {
    return res.status(400).json({ detail: "自动化 ID 无效" });
  }
  if (!messageKey) {
    return res.status(400).json({ detail: "邮件唯一标识不能为空" });
  }

  try {
    const automation = await getAutomation(userId, automationId);
    if (!automation || automation.trigger_type !== "邮件触发") {
      return res.status(404).json({ detail: "邮件触发自动化不存在" });
    }

    const claimed = await claimAutomationEmailMessage(
      userId,
      mailboxKey,
      messageKey,
      automationId,
    );

    return res.status(200).json({ claimed });
  } catch (error) {
    console.error("[Automation Email Claim API] error:", error);
    return res.status(500).json({ detail: "邮件去重记录失败" });
  }
}
