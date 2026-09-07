import { getUserIdFromRequest } from "@/lib/auth";
import { getAutomation, getAutomationEmailRoutingStats } from "@/lib/automation/store";
import type { NextApiRequest, NextApiResponse } from "next";

function parseAutomationId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const automationId = parseAutomationId(req.query.automation_id);
    if (!automationId) {
      return res.status(400).json({ error: "Invalid automation_id" });
    }

    const automation = await getAutomation(userId, automationId);
    if (!automation || automation.trigger_type !== "邮件触发") {
      return res.status(404).json({ error: "Email automation not found" });
    }

    const stats = await getAutomationEmailRoutingStats(userId, automationId);
    return res.status(200).json(stats);
  } catch (error: any) {
    console.error("[Automation Email Stats API] Error:", error);
    return res.status(500).json({
      error: "Failed to load email routing statistics",
      detail: process.env.NODE_ENV === "development" ? error?.message || "Unknown error" : undefined,
    });
  }
}
