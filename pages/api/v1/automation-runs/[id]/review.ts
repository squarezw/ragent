import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { executeAutomationAgent } from "@/lib/automation/execute";
import { executeRunActions } from "@/lib/automation/actions";
import {
  approveRunReview,
  beginRunRegeneration,
  getRunForUser,
  listRunActions,
  listRunReviewHistory,
  markRunPendingReview,
  rejectRunReview,
  restoreRunAfterRegenerationFailure,
  runActionRowToApi,
  runRowToApi,
  saveRunReviewDraft,
} from "@/lib/automation/store";

function parseId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function historyRowToApi(row: any) {
  return {
    id: row.id,
    eventType: row.event_type,
    aiVersion: row.ai_version ?? undefined,
    content: row.content ?? undefined,
    note: row.note ?? undefined,
    actorUserId: row.actor_user_id ?? undefined,
    createdAt: row.created_at,
  };
}

function errorResponse(res: NextApiResponse, error: any) {
  const code = error?.message || "";

  if (code === "RUN_NOT_FOUND") {
    return res.status(404).json({ detail: "运行记录不存在" });
  }
  if (code === "RUN_STATE_CONFLICT") {
    return res.status(409).json({ detail: "当前运行状态已变化，请刷新后重试" });
  }
  if (code === "EMPTY_REVIEW_CONTENT") {
    return res.status(400).json({ detail: "审核内容不能为空" });
  }
  if (code === "EMPTY_REGENERATION_ADVICE") {
    return res.status(400).json({ detail: "请填写重新生成的修改建议" });
  }

  console.error("[Automation Review API] error:", error);
  return res.status(500).json({ detail: "审核操作失败" });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  const runId = parseId(req.query.id);
  if (!runId) return res.status(400).json({ detail: "Invalid run id" });

  const existing = await getRunForUser(userId, runId);
  if (!existing) return res.status(404).json({ detail: "运行记录不存在" });

  // V1 权限：只有该 Run / 自动化的创建者可以审核。
  if (Number(existing.created_by_user_id) !== Number(userId)) {
    return res.status(403).json({ detail: "无权审核该运行记录" });
  }

  if (req.method === "GET") {
    try {
      const [history, actions] = await Promise.all([
        listRunReviewHistory(userId, runId),
        listRunActions(userId, runId),
      ]);
      return res.status(200).json({
        run: runRowToApi(existing),
        history: history.map(historyRowToApi),
        actions: actions.map(runActionRowToApi),
      });
    } catch (error: any) {
      return errorResponse(res, error);
    }
  }

  if (req.method === "PATCH") {
    const content = typeof req.body?.content === "string" ? req.body.content : "";

    try {
      const updated = await saveRunReviewDraft(userId, runId, content);
      return res.status(200).json({ run: runRowToApi(updated) });
    } catch (error: any) {
      return errorResponse(res, error);
    }
  }

  if (req.method === "POST") {
    const action = typeof req.body?.action === "string" ? req.body.action : "";

    if (action === "approve") {
      try {
        const content =
          typeof req.body?.content === "string" ? req.body.content : undefined;

        // 审核通过只锁定当前审核内容；这里绝不会再次调用数字员工。
        // 如配置了结果邮件 / 结果接收 URL，则使用 final_result 执行后续操作。
        const approved = await approveRunReview(userId, runId, content);

        if (approved?.status === "action_running") {
          const executed = await executeRunActions({ userId, runId });
          return res.status(200).json(executed);
        }

        const actions = await listRunActions(userId, runId);
        return res.status(200).json({
          run: runRowToApi(approved),
          actions: actions.map(runActionRowToApi),
        });
      } catch (error: any) {
        return errorResponse(res, error);
      }
    }

    if (action === "reject") {
      try {
        const reason =
          typeof req.body?.reason === "string" ? req.body.reason : undefined;
        const updated = await rejectRunReview(userId, runId, reason);
        return res.status(200).json({ run: runRowToApi(updated) });
      } catch (error: any) {
        return errorResponse(res, error);
      }
    }

    if (action === "regenerate") {
      const advice =
        typeof req.body?.advice === "string" ? req.body.advice.trim() : "";
      const currentContent =
        typeof req.body?.content === "string" ? req.body.content.trim() : "";

      if (!advice) {
        return res.status(400).json({ detail: "请填写重新生成的修改建议" });
      }

      try {
        if (currentContent && currentContent !== String(existing.review_content || existing.result || "").trim()) {
          await saveRunReviewDraft(userId, runId, currentContent);
        }

        const regenerating = await beginRunRegeneration(userId, runId, advice);

        const originalTask =
          String(regenerating.task_snapshot || "").trim() || "请完成原自动化任务";
        const reviewDraft =
          String(regenerating.review_content || regenerating.result || "").trim();
        const triggerContext = regenerating.trigger_context || {};

        const question = [
          "【原自动化任务】",
          originalTask,
          "",
          "【本次触发上下文】",
          JSON.stringify(triggerContext, null, 2),
          "",
          "【当前审核稿】",
          reviewDraft || "暂无",
          "",
          "【审核人的修改建议】",
          advice,
          "",
          "【重新生成要求】",
          "请结合原任务、本次触发上下文、当前审核稿和修改建议，重新生成一份完整可直接使用的结果。",
          "不要只说明修改点，也不要输出分析过程。",
        ].join("\n");

        try {
          const result = await executeAutomationAgent({
            userId,
            appId: Number(regenerating.app_id),
            question,
          });

          const answer = result.answer || "任务已完成，未返回文本结果";
          const updated = await markRunPendingReview(
            runId,
            answer,
            userId,
            advice
          );

          return res.status(200).json({
            run: runRowToApi(updated),
            answer,
            reference: result.reference,
            segment_ids: result.segment_ids,
            detail_id: result.detail_id,
          });
        } catch (agentError: any) {
          const message = agentError?.message || "重新生成失败";
          const restored = await restoreRunAfterRegenerationFailure(
            userId,
            runId,
            String(message)
          );

          console.error("[Automation Review Regenerate] failed:", agentError);
          return res.status(500).json({
            detail: message,
            run: runRowToApi(restored),
          });
        }
      } catch (error: any) {
        return errorResponse(res, error);
      }
    }

    return res.status(400).json({ detail: "不支持的审核操作" });
  }

  res.setHeader("Allow", ["GET", "PATCH", "POST"]);
  return res.status(405).json({ detail: "Method Not Allowed" });
}
