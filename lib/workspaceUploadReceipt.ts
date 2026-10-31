import jwt from "jsonwebtoken";
import type { WorkspaceContext } from "./workspaceTenant";
/** Verify only authenticated operation-bound receipts, never infer ownership from object names. */
export function verifyWorkspaceUploadReceipt(
  ctx: WorkspaceContext,
  receipt: unknown,
  objectKey: string,
  contentType?: string
): boolean {
  if (!ctx.enabled) return true;
  if (typeof receipt !== "string" || !process.env.JWT_SECRET) return false;
  try {
    const value = jwt.verify(receipt, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "ragent-upload",
      audience: "ragent-workspace-upload",
    });
    if (typeof value === "string") return false;
    return (
      value.v === 2 &&
      value.purpose === "workspace_upload" &&
      value.sub === String(ctx.actorUserId) &&
      value.object_key === objectKey &&
      value.operation_tenant_id === ctx.tenantId &&
      typeof value.iat === "number" &&
      typeof value.exp === "number" &&
      value.exp > value.iat &&
      value.exp - value.iat <= 7200 &&
      (!contentType || value.content_type === contentType)
    );
  } catch {
    return false;
  }
}

/** Internal scheduled jobs only: ctx must come from the persisted task's immutable actor/tenant. */
export function signWorkspaceUploadReceipt(
  ctx: WorkspaceContext,
  objectKey: string,
  contentType: string
): string {
  if (
    !ctx.enabled ||
    !Number.isSafeInteger(ctx.actorUserId) ||
    !Number.isSafeInteger(ctx.tenantId) ||
    !process.env.JWT_SECRET
  )
    throw new Error("WORKSPACE_UPLOAD_CONTEXT_REQUIRED");
  return jwt.sign(
    {
      v: 2,
      purpose: "workspace_upload",
      sub: String(ctx.actorUserId),
      object_key: objectKey,
      content_type: contentType,
      operation_tenant_id: ctx.tenantId,
    },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: "ragent-upload",
      audience: "ragent-workspace-upload",
      expiresIn: 7200,
    }
  );
}
