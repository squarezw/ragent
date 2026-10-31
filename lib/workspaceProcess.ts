import type { NextApiHandler } from "next";
import axios from "axios";
import pool from "./db";
import { requireWorkspaceTenant } from "./workspaceTenant";
import { getCompanyCodeByTenantId } from "./tenantMapping";
const base = (process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030").replace(/\/$/, "");
/** External process resources are checked by their fixed company/node chain before actor RBAC. */
export function withProcessWorkspace(handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    const ctx = await requireWorkspaceTenant(req, res);
    if (!ctx) return;
    if (!ctx.enabled) return handler(req, res);
    const company = getCompanyCodeByTenantId(ctx.tenantId!);
    if (!company) return res.status(403).json({ detail: { code: "WORKSPACE_COMPANY_UNMAPPED" } });
    try {
      const seen = new Set<string>();
      const nodeAllowed = async (id: unknown, depth = 0): Promise<boolean> => {
        if (!id || depth > 20 || seen.has(String(id))) return false;
        seen.add(String(id));
        const result = await axios.get(
          `${base}/api/v1/process-nodes/${encodeURIComponent(String(id))}`
        );
        const node = result.data?.data;
        if (!node) return false;
        if (node.company_code != null) return String(node.company_code).toUpperCase() === company;
        return node.parent_id ? nodeAllowed(node.parent_id, depth + 1) : false;
      };
      const path = (req.url || "").split("?")[0];
      const sessions = [
        ...(path.includes("/handbook/") ? [req.query.sessionId, req.query.session_id] : []),
        req.query.from_session,
      ].filter((value) => value != null);
      for (const session of sessions) {
        const resource = await pool.query(
          "SELECT created_by FROM external_workspace_resources WHERE kind='process_handbook' AND external_id=$1 AND operation_tenant_id=$2",
          [String(session), ctx.tenantId]
        );
        if (!resource.rows.length || (!ctx.isSuperAdmin && Number(resource.rows[0].created_by) !== ctx.actorUserId))
          return res.status(404).json({ detail: "WORKSPACE_RESOURCE_NOT_FOUND" });
      }
      const nodes = [
        req.query.node_id,
        req.body?.node_id,
        req.body?.parent_id,
        req.body?.target_node_id,
        req.body?.source_node_id,
      ].filter((v) => v != null);
      if (/\/process-nodes\//.test(path)) nodes.push(req.query.id);
      if (/\/process-documents\//.test(path) && req.query.id) {
        const result = await axios.get(
          `${base}/api/v1/process-documents/${encodeURIComponent(String(req.query.id))}`
        );
        const doc = result.data?.data;
        if (!doc?.node_id) return res.status(404).json({ detail: "WORKSPACE_RESOURCE_NOT_FOUND" });
        nodes.push(doc.node_id);
      }
      for (const id of [...new Set(nodes.map(String))]) {
        seen.clear();
        if (!(await nodeAllowed(id)))
          return res.status(404).json({ detail: "WORKSPACE_RESOURCE_NOT_FOUND" });
      }
      const sourceIds = Array.isArray(req.body?.source_file_ids)
        ? req.body.source_file_ids.map(String)
        : [];
      if (sourceIds.length) {
        const source = await pool.query(
          `SELECT f.id FROM knowledge_files f JOIN datasets d ON d.id=f.dataset_id WHERE f.id::text=ANY($1::text[]) AND (d.owner_tenant_id=$2 OR d.visibility='public') AND (can_access_dataset($3,d.id) OR d.visibility='public')`,
          [sourceIds, ctx.tenantId, ctx.actorUserId]
        );
        if (source.rows.length !== new Set(sourceIds).size)
          return res.status(404).json({ detail: "WORKSPACE_RESOURCE_NOT_FOUND" });
      }
      if (Array.isArray(req.body?.source_file_keys)) {
        const { workspaceCanReadObject } = await import("./workspaceFiles");
        for (const key of req.body.source_file_keys)
          if (typeof key !== "string" || !(await workspaceCanReadObject(ctx, key)))
            return res.status(404).json({ detail: "WORKSPACE_RESOURCE_NOT_FOUND" });
      }
      const kbIds = [req.body?.knowledge_file_id, req.body?.file_id, req.query.from_knowledge_file].filter((value) => value != null);
      for (const kbId of kbIds) {
        const file = await pool.query(
          `SELECT f.id FROM knowledge_files f JOIN datasets d ON d.id=f.dataset_id WHERE f.id::text=$1 AND (d.owner_tenant_id=$2 OR d.visibility='public') AND (can_access_dataset($3,d.id) OR d.visibility='public')`,
          [String(kbId), ctx.tenantId, ctx.actorUserId]
        );
        if (!file.rows.length)
          return res.status(404).json({ detail: "WORKSPACE_RESOURCE_NOT_FOUND" });
      }
      if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        if (
          req.body.company_code != null &&
          String(req.body.company_code).toUpperCase() !== company
        )
          return res.status(403).json({ detail: "WORKSPACE_TENANT_FORBIDDEN" });
        req.body.company_code = company;
      }
      if (req.query.company_code && String(req.query.company_code).toUpperCase() !== company)
        return res.status(403).json({ detail: "WORKSPACE_TENANT_FORBIDDEN" });
      req.query.company_code = company;
      if (path.endsWith("/handbook/sessions") && !req.query.node_id)
        return res.status(409).json({ detail: "WORKSPACE_NODE_REQUIRED" });
      return handler(req, res);
    } catch {
      if (!res.headersSent) return res.status(503).json({ detail: "WORKSPACE_SCOPE_UNAVAILABLE" });
    }
  };
}

export async function bindProcessWorkspaceSession(
  req: import("next").NextApiRequest,
  res: import("next").NextApiResponse,
  result: any
): Promise<boolean> {
  if (process.env.WORKSPACE_TENANT_ENABLED !== "true") return true;
  const ctx = await requireWorkspaceTenant(req, res);
  if (!ctx) return false;
  const id = result?.session_id || result?.data?.session_id;
  if (typeof id !== "string" || !id) {
    res.status(502).json({ detail: "WORKSPACE_EXTERNAL_SESSION_CONTRACT_INVALID" });
    return false;
  }
  const saved = await pool.query(
    `INSERT INTO external_workspace_resources(kind,external_id,operation_tenant_id,created_by)
    VALUES('process_handbook',$1,$2,$3) ON CONFLICT(kind,external_id) DO UPDATE SET external_id=EXCLUDED.external_id
    WHERE external_workspace_resources.operation_tenant_id=EXCLUDED.operation_tenant_id
      AND external_workspace_resources.created_by=EXCLUDED.created_by RETURNING external_id`,
    [id, ctx.tenantId, ctx.actorUserId]
  );
  if (!saved.rows.length) {
    res.status(409).json({ detail: "WORKSPACE_EXTERNAL_RESOURCE_CONFLICT" });
    return false;
  }
  return true;
}
