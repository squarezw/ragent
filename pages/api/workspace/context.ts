import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest, getTokenFromRequest } from "@/lib/auth";
import { getUserPermissions } from "@/lib/permissions";
import { workspaceEnabled } from "@/lib/workspaceTenant";
import { getCompanyCodeByTenantId } from "@/lib/tenantMapping";
import pool from "@/lib/db";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const enabled = workspaceEnabled();
  if (!enabled) return res.json({ enabled, tenants: [] });
  try {
    const base = (process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010").replace(/\/$/, "");
    const response = await fetch(`${base}/api/v1/workspace/context`, {
      headers: { Authorization: `Bearer ${getTokenFromRequest(req)}` },
      signal: AbortSignal.timeout(5000),
    });
    const capabilities = await response.json();
    if (!response.ok || capabilities.enabled !== true)
      return res.status(503).json({ error: "WORKSPACE_BACKEND_NOT_READY" });
  } catch {
    return res.status(503).json({ error: "WORKSPACE_BACKEND_NOT_READY" });
  }
  const permissions = await getUserPermissions(userId);
  const actor = await pool.query("SELECT tenant_id, status FROM users WHERE id = $1", [userId]);
  if (actor.rows[0]?.status !== "active" || !permissions) return res.status(403).end();
  const isSuper = permissions.roles.some((r) => r.name === "超级管理员" && r.isSystem);
  const result = await pool.query(
    "SELECT id, name, code FROM tenant WHERE status = 'active' AND ($1::boolean OR id = $2) ORDER BY name, id",
    [isSuper, actor.rows[0].tenant_id]
  );
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    enabled,
    tenants: result.rows.map((tenant) => ({
      ...tenant,
      company_code: getCompanyCodeByTenantId(tenant.id) || null,
    })),
  });
}
