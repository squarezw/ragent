import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { executeAutomationAgent } from "@/lib/automation/execute";
import { executeRunActions } from "@/lib/automation/actions";
import {
  createRun,
  finishRun,
  getAutomation,
  markRunPendingReview,
  prepareAutomaticRunActions,
  runRowToApi,
} from "@/lib/automation/store";

function parseId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const ALLOWED_RUN_TRIGGERS = new Set([
  "手动触发",
  "定时触发",
  "邮件触发",
  "Webhook / API",
  "自动化完成触发",
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ detail: "Method Not Allowed" });
  }

  const id = parseId(req.query.id);
  if (!id) return res.status(400).json({ detail: "Invalid automation id" });

  const task = await getAutomation(userId, id);
  if (!task) return res.status(404).json({ detail: "自动化不存在" });

  const requestedTrigger =
    typeof req.body?.trigger === "string" && ALLOWED_RUN_TRIGGERS.has(req.body.trigger)
      ? req.body.trigger
      : "手动触发";

  const triggerContext =
    req.body?.triggerContext &&
    typeof req.body.triggerContext === "object" &&
    !Array.isArray(req.body.triggerContext)
      ? req.body.triggerContext
      : {};

  const question =
    typeof req.body?.question === "string" && req.body.question.trim()
      ? req.body.question.trim()
      : task.task;

  const runTask = {
    ...task,
    trigger_type: requestedTrigger,
  };

  const run = await createRun(runTask, "running", {
    ...triggerContext,
    source: triggerContext.source || requestedTrigger,
    firedAt: triggerContext.firedAt || new Date().toISOString(),
  });

  try {
    const result = await executeAutomationAgent({
      userId,
      appId: task.app_id,
      question,
    });

    const answer = result.answer || "任务已完成，未返回文本结果";
    const needsReview = task.strategy === "需要确认后执行";

    if (needsReview) {
      const pending = await markRunPendingReview(run.id, answer);
      return res.status(200).json({
        run: runRowToApi(pending),
        answer,
        reference: result.reference,
        segment_ids: result.segment_ids,
        detail_id: result.detail_id,
      });
    }

    if (task.strategy === "自动执行") {
      const prepared = await prepareAutomaticRunActions(userId, run.id, answer);
      if (prepared?.status === "action_running") {
        const executed = await executeRunActions({ userId, runId: run.id });
        return res.status(200).json({
          ...executed,
          answer,
          reference: result.reference,
          segment_ids: result.segment_ids,
          detail_id: result.detail_id,
        });
      }

      return res.status(200).json({
        run: runRowToApi(prepared),
        actions: [],
        answer,
        reference: result.reference,
        segment_ids: result.segment_ids,
        detail_id: result.detail_id,
      });
    }

    const finished = await finishRun(run.id, "success", answer);
    return res.status(200).json({
      run: runRowToApi(finished),
      answer,
      reference: result.reference,
      segment_ids: result.segment_ids,
      detail_id: result.detail_id,
    });
  } catch (error: any) {
    const message = error?.message || "Automation execution failed";
    const finished = await finishRun(run.id, "failed", undefined, message);

    console.error("[Automation Manual Run] failed:", error);
    return res.status(500).json({
      detail: message,
      run: runRowToApi(finished),
    });
  }
}
