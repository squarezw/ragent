import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { listRuns, runRowToApi } from "@/lib/automation/store";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ detail: "Method Not Allowed" });
  }

  const raw = Array.isArray(req.query.automation_id)
    ? req.query.automation_id[0]
    : req.query.automation_id;
  const automationId = raw ? Number(raw) : undefined;

  try {
    const rows = await listRuns(
      userId,
      Number.isInteger(automationId) && Number(automationId) > 0 ? Number(automationId) : undefined
    );

    return res.status(200).json({ items: rows.map(runRowToApi) });
  } catch (error) {
    console.error("[Automation Runs API] error:", error);
    return res.status(500).json({ detail: "运行记录加载失败" });
  }
}
