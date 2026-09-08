import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  automationRowToApi,
  deleteAutomation,
  getAutomation,
  updateAutomation,
} from "@/lib/automation/store";

const SCHEDULE_ERROR_MESSAGES: Record<string, string> = {
  SCHEDULE_PERIOD_REQUIRED: "请选择执行周期",
  SCHEDULE_TIME_REQUIRED: "请选择执行时间",
  SCHEDULE_INVALID_TIME: "执行时间格式不正确",
  SCHEDULE_TIMEZONE_REQUIRED: "请选择时区",
  SCHEDULE_INVALID_TIMEZONE: "所选时区无效，请重新选择",
  SCHEDULE_WEEKDAY_REQUIRED: "每周执行时请至少选择一个星期",
  SCHEDULE_MONTH_DAY_REQUIRED: "每月执行时请选择具体日期",
  SCHEDULE_MONTH_POLICY_REQUIRED: "请选择当月没有该日期时的处理方式",
  SCHEDULE_DATE_REQUIRED: "仅一次执行时请选择具体日期",
  SCHEDULE_INVALID_DATE: "执行日期无效，请重新选择",
  SCHEDULE_LOCAL_TIME_INVALID: "该日期和时间在所选时区不存在，请重新选择",
  SCHEDULE_ONCE_EXPIRED: "仅一次执行时间必须晚于当前时间",
  SCHEDULE_NO_NEXT_RUN: "无法计算下一次执行时间，请检查定时配置",
};

function scheduleErrorResponse(code: string) {
  return SCHEDULE_ERROR_MESSAGES[code] || null;
}

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

    const scheduleMessage = scheduleErrorResponse(code);
    if (scheduleMessage) return res.status(400).json({ detail: scheduleMessage });

    console.error("[Automation API] error:", error);
    return res.status(500).json({ detail: "自动化任务更新失败" });
  }
}
