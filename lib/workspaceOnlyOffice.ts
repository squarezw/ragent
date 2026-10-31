import jwt from "jsonwebtoken";
import axios from "axios";
import pool from "./db";
import { getCompanyCodeByTenantId } from "./tenantMapping";
import { requireWorkspaceTenant } from "./workspaceTenant";
import type { NextApiRequest, NextApiResponse } from "next";
import { requireEnv } from "./env";
const base = (process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030").replace(/\/$/, "");
const audience = "ragent-onlyoffice-workspace";
export type OfficeScope = {
  actor: number;
  tenant: number;
  type: "doc" | "session" | "file";
  id: string;
  key?: string;
};
export async function officeResourceAllowed(scope: OfficeScope): Promise<boolean> {
  const active = await pool.query(
    "SELECT 1 FROM users u JOIN tenant t ON t.id=$2 WHERE u.id=$1 AND u.status='active' AND t.status='active' AND (u.tenant_id=t.id OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.is_system=true AND r.name='超级管理员'))",
    [scope.actor, scope.tenant]
  );
  if (!active.rows.length) return false;
  if (scope.type === "file") {
    const row = await pool.query(
      "SELECT f.id FROM knowledge_files f JOIN datasets d ON d.id=f.dataset_id WHERE f.id::text=$1 AND d.owner_tenant_id=$2 AND can_access_dataset($3,d.id)",
      [scope.id, scope.tenant, scope.actor]
    );
    return !!row.rows.length;
  }
  if (scope.type === "session") {
    const row = await pool.query(
      "SELECT 1 FROM external_workspace_resources WHERE kind='process_handbook' AND external_id=$1 AND operation_tenant_id=$2 AND (created_by=$3 OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$3 AND r.is_system=true AND r.name='超级管理员'))",
      [scope.id, scope.tenant, scope.actor]
    );
    return !!row.rows.length;
  }
  const company = getCompanyCodeByTenantId(scope.tenant);
  if (!company) return false;
  const result = await axios.get(
    `${base}/api/v1/process-documents/${encodeURIComponent(scope.id)}`
  );
  let nodeId = result.data?.data?.node_id;
  const seen = new Set<string>();
  while (nodeId && seen.size < 20 && !seen.has(String(nodeId))) {
    seen.add(String(nodeId));
    const result = await axios.get(
      `${base}/api/v1/process-nodes/${encodeURIComponent(String(nodeId))}`
    );
    const node = result.data?.data;
    if (node?.company_code != null) return String(node.company_code).toUpperCase() === company;
    nodeId = node?.parent_id;
  }
  return false;
}
export async function officeRequestScope(
  req: NextApiRequest,
  res: NextApiResponse,
  type: unknown,
  id: unknown
): Promise<OfficeScope | null | false> {
  const ctx = await requireWorkspaceTenant(req, res);
  if (!ctx) return false;
  if (!ctx.enabled) return null;
  if (!["doc", "session", "file"].includes(String(type)) || typeof id !== "string" || !id) {
    res.status(400).json({ detail: "Invalid document resource" });
    return false;
  }
  const scope: OfficeScope = {
    actor: ctx.actorUserId!,
    tenant: ctx.tenantId!,
    type: type as OfficeScope["type"],
    id,
  };
  try {
    if (await officeResourceAllowed(scope)) return scope;
  } catch {
    res.status(503).json({ detail: "WORKSPACE_SCOPE_UNAVAILABLE" });
    return false;
  }
  res.status(404).json({ detail: "WORKSPACE_RESOURCE_NOT_FOUND" });
  return false;
}
export function signOfficeScope(scope: OfficeScope): string {
  return jwt.sign(scope, requireEnv("ONLYOFFICE_JWT_SECRET"), {
    algorithm: "HS256",
    audience,
    issuer: "ragent",
    expiresIn: "1h",
  });
}
export async function verifyOfficeScope(
  token: unknown,
  type: OfficeScope["type"],
  id: string,
  key?: string
): Promise<OfficeScope | null> {
  try {
    if (typeof token !== "string") return null;
    const value = jwt.verify(token, requireEnv("ONLYOFFICE_JWT_SECRET"), {
      algorithms: ["HS256"],
      audience,
      issuer: "ragent",
    }) as OfficeScope;
    if (
      !Number.isSafeInteger(value.actor) ||
      !Number.isSafeInteger(value.tenant) ||
      value.actor < 1 ||
      value.tenant < 1 ||
      value.type !== type ||
      value.id !== id ||
      (key !== undefined && value.key !== key)
    )
      return null;
    return (await officeResourceAllowed(value)) ? value : null;
  } catch {
    return null;
  }
}
export function officeBackendHeaders(scope: OfficeScope): Record<string, string> {
  return {
    Authorization: `Bearer ${jwt.sign({ userId: scope.actor }, requireEnv("JWT_SECRET"), { algorithm: "HS256", expiresIn: "60s" })}`,
    "X-Workspace-Tenant-ID": String(scope.tenant),
  };
}
export function officeCapabilityUrl(baseUrl: string, docKey: string, scope: OfficeScope): string {
  return `${baseUrl}/api/internal/onlyoffice/download/${encodeURIComponent(docKey)}?cap=${encodeURIComponent(signOfficeScope(scope))}`;
}
