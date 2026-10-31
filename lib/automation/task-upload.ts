import { workspaceEnabled } from "@/lib/workspaceTenant";
import { signWorkspaceUploadReceipt } from "@/lib/workspaceUploadReceipt";
import type { AutomationAgentAttachment } from "@/lib/automation/agent-payload";

/** Only call immediately after this process uploads bytes for a persisted task. */
export function taskUploadAttachment(
  task: { created_by_user_id?: unknown; tenant_id?: unknown },
  attachment: AutomationAgentAttachment
): AutomationAgentAttachment {
  if (!workspaceEnabled()) return attachment;
  const actorUserId = Number(task.created_by_user_id);
  const tenantId = Number(task.tenant_id);
  if (
    !Number.isSafeInteger(actorUserId) ||
    actorUserId <= 0 ||
    !Number.isSafeInteger(tenantId) ||
    tenantId <= 0
  ) {
    throw new Error("AUTOMATION_TENANT_SNAPSHOT_REQUIRED");
  }
  const contentType = attachment.contentType || "application/octet-stream";
  return {
    ...attachment,
    contentType,
    uploadReceipt: signWorkspaceUploadReceipt(
      { enabled: true, actorUserId, tenantId },
      attachment.objectKey,
      contentType
    ),
  };
}
