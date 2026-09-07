import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { automationRowToApi, createAutomation, listAutomations } from "@/lib/automation/store";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  try {
    if (req.method === "GET") {
      const rows = await listAutomations(userId);
      return res.status(200).json({ items: rows.map(automationRowToApi) });
    }

    if (req.method === "POST") {
      const row = await createAutomation(userId, req.body || {});
      return res.status(201).json(automationRowToApi(row));
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ detail: `Method ${req.method} Not Allowed` });
  } catch (error: any) {
    const code = error?.message || "";
    if (code === "INVALID_APP_ID") return res.status(400).json({ detail: "请选择有效的数字员工" });
    if (code === "APP_NOT_FOUND") return res.status(404).json({ detail: "数字员工不存在" });
    if (code === "NAME_REQUIRED") return res.status(400).json({ detail: "请填写自动化名称" });
    if (code === "TASK_REQUIRED") return res.status(400).json({ detail: "请填写任务说明" });

    console.error("[Automations API] error:", error);
    return res.status(500).json({ detail: "自动化任务保存失败" });
  }
}
