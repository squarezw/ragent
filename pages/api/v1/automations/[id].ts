import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  automationRowToApi,
  deleteAutomation,
  getAutomation,
  updateAutomation,
} from "@/lib/automation/store";

function parseId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  const id = parseId(req.query.id);
  if (!id) return res.status(400).json({ detail: "Invalid automation id" });

  try {
    if (req.method === "GET") {
      const row = await getAutomation(userId, id);
      if (!row) return res.status(404).json({ detail: "自动化不存在" });
      return res.status(200).json(automationRowToApi(row));
    }

    if (req.method === "PUT") {
      const row = await updateAutomation(userId, id, req.body || {});
      if (!row) return res.status(404).json({ detail: "自动化不存在" });
      return res.status(200).json(automationRowToApi(row));
    }

    if (req.method === "DELETE") {
      const result = await deleteAutomation(userId, id);

      if (result.dependents.length > 0) {
        return res.status(409).json({
          detail: "该自动化正在被其他自动化作为上游任务使用",
          dependents: result.dependents,
        });
      }

      if (!result.deleted) return res.status(404).json({ detail: "自动化不存在" });
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    return res.status(405).json({ detail: `Method ${req.method} Not Allowed` });
  } catch (error: any) {
    const code = error?.message || "";
    if (code === "APP_NOT_FOUND") return res.status(404).json({ detail: "数字员工不存在" });
    if (code === "NAME_REQUIRED") return res.status(400).json({ detail: "请填写自动化名称" });
    if (code === "TASK_REQUIRED") return res.status(400).json({ detail: "请填写任务说明" });

    console.error("[Automation API] error:", error);
    return res.status(500).json({ detail: "自动化任务更新失败" });
  }
}
