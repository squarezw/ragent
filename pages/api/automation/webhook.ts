import { requireWorkspaceTenant, workspaceEnabled } from "@/lib/workspaceTenant";
import { getAutomation } from "@/lib/automation/store";
import { withAutomationWorkspace } from "@/lib/automation/workspace";
import { requireAuth } from "@/lib/auth";
import type { NextApiRequest, NextApiResponse } from "next";

type WebhookEvent = {
  id: string;
  tenant_id?: number | null;
  actor_user_id?: number | null;
  automation_id: number;
  payload: unknown;
  received_at: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __ragentAutomationWebhookQueue: WebhookEvent[] | undefined;
}

function getQueue() {
  if (!globalThis.__ragentAutomationWebhookQueue) {
    globalThis.__ragentAutomationWebhookQueue = [];
  }
  return globalThis.__ragentAutomationWebhookQueue;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // The legacy anonymous webhook has no verifiable credential/resource binding.
  // When workspaces are enabled it fails closed; authenticated callers must own
  // the target automation in the selected workspace.
  const workspace = workspaceEnabled() ? await requireWorkspaceTenant(req, res) : null;
  if (workspaceEnabled() && !workspace) return;
  if (req.method === "POST") {
    const rawAutomationId = req.query.automation_id ?? req.body?.automation_id;
    const automationId = Number(rawAutomationId);

    if (!Number.isInteger(automationId) || automationId <= 0) {
      return res.status(400).json({
        error: "Invalid automation_id",
        detail: "请在 URL 中提供有效的 automation_id，例如 ?automation_id=123456",
      });
    }

    if (workspace?.enabled) {
      const task = await withAutomationWorkspace(workspace, () =>
        getAutomation(workspace.actorUserId!, automationId));
      if (!task) return res.status(404).json({ error: "Automation not found" });
    }

    const event: WebhookEvent = {
      tenant_id: workspace?.tenantId,
      actor_user_id: workspace?.actorUserId,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      automation_id: automationId,
      payload: req.body?.payload ?? req.body ?? {},
      received_at: new Date().toISOString(),
    };

    const queue = getQueue();
    queue.push(event);
    if (queue.length > 100) queue.splice(0, queue.length - 100);

    return res.status(202).json({
      success: true,
      event_id: event.id,
      automation_id: automationId,
      message: "Webhook 事件已接收，等待自动化页面领取执行",
    });
  }

  if (req.method === "GET") {
    if (!requireAuth(req, res)) return;

    const queue = getQueue();
    const events = workspace?.enabled
      ? queue.filter((event) => event.tenant_id === workspace.tenantId && event.actor_user_id === workspace.actorUserId)
      : queue.splice(0, queue.length);
    if (workspace?.enabled) {
      const claimed = new Set(events.map((event) => event.id));
      globalThis.__ragentAutomationWebhookQueue = queue.filter((event) => !claimed.has(event.id));
    }

    return res.status(200).json({ success: true, events });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method Not Allowed" });
}
