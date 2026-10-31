import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "./auth";
import { getUserPermissions } from "./permissions";
import pool from "./db";

export const WORKSPACE_HEADER = "X-Workspace-Tenant-ID";
export function workspaceEnabled(): boolean {
  return process.env.WORKSPACE_TENANT_ENABLED === "true";
}
export interface WorkspaceContext {
  enabled: boolean;
  tenantId: number | null;
  actorUserId: number | null;
  isSuperAdmin?: boolean;
  accountTenantId?: number | null;
}
export function workspaceHeaders(req: NextApiRequest): Record<string, string> {
  if (!workspaceEnabled()) return {};
  const value = req.headers["x-workspace-tenant-id"] || req.query.workspace_tenant_id;
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? { [WORKSPACE_HEADER]: value } : {};
}
export async function requireWorkspaceTenant(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<WorkspaceContext | null> {
  const actorUserId = getUserIdFromRequest(req);
  if (!workspaceEnabled()) return { enabled: false, tenantId: null, actorUserId };
  const fail = (status: number, code: string) => {
    res.status(status).json({ detail: { code, message: code } });
    return null;
  };
  if (!actorUserId) return fail(401, "UNAUTHORIZED");
  const header = req.headers["x-workspace-tenant-id"];
  const query = req.query.workspace_tenant_id;
  if (header && query && header !== query) return fail(403, "WORKSPACE_TENANT_INVALID");
  const value = header || query;
  if (!value) return fail(409, "WORKSPACE_TENANT_REQUIRED");
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    return fail(403, "WORKSPACE_TENANT_INVALID");
  const tenantId = Number(value);
  const permissions = await getUserPermissions(actorUserId);
  const actor = await pool.query("SELECT tenant_id, status FROM users WHERE id = $1", [
    actorUserId,
  ]);
  if (!permissions || actor.rows[0]?.status !== "active") return fail(403, "ACCOUNT_DISABLED");
  const isSuperAdmin = permissions.roles.some((r) => r.name === "超级管理员" && r.isSystem);
  const accountTenantId = actor.rows[0].tenant_id == null ? null : Number(actor.rows[0].tenant_id);
  if (!isSuperAdmin && accountTenantId !== tenantId) return fail(403, "WORKSPACE_TENANT_FORBIDDEN");
  const tenant = await pool.query("SELECT id FROM tenant WHERE id = $1 AND status = 'active'", [
    tenantId,
  ]);
  if (!tenant.rows.length) return fail(403, "WORKSPACE_TENANT_INVALID");
  return { enabled: true, tenantId, actorUserId, isSuperAdmin, accountTenantId };
}
