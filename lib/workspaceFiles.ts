import type { NextApiRequest, NextApiResponse } from "next";
import pool from "./db";
import { buildVisibilityScope } from "./visibilityScope";
import { requireWorkspaceTenant, type WorkspaceContext } from "./workspaceTenant";

export async function workspaceCanReadObject(
  ctx: WorkspaceContext,
  objectKey: string
): Promise<boolean> {
  if (!ctx.enabled) return true;
  if (objectKey.startsWith("app-avatars/")) {
    // An avatar is authorized by its exact live app reference, never its prefix alone.
    const avatar = await pool.query(
      `SELECT a.id FROM apps a WHERE a.avatar_url=$1 AND a.owner_tenant_id=$2
       AND can_access_app($3,a.id) LIMIT 1`,
      [`/api/oss/${objectKey}`, ctx.tenantId, ctx.actorUserId]
    );
    return avatar.rows.length > 0;
  }
  const knowledge = await pool.query(
    `SELECT f.id FROM knowledge_files f JOIN datasets d ON d.id=f.dataset_id
     WHERE f.object_key=$1 AND f.status <> 'deleted' AND (d.owner_tenant_id=$2 OR d.visibility='public') AND (can_access_dataset($3,d.id) OR d.visibility='public') LIMIT 1`,
    [objectKey, ctx.tenantId, ctx.actorUserId]
  );
  if (knowledge.rows.length) return true;
  const scope = await buildVisibilityScope(
    ctx.actorUserId!,
    { userIdCol: "cs.user_id", userAlias: "u" },
    3
  );
  if (!scope) return false;
  const artifact = await pool.query(
    `SELECT r.external_id FROM external_workspace_resources r JOIN users u ON u.id=r.created_by JOIN LATERAL (SELECT r.created_by AS user_id) cs ON true
     WHERE r.kind='skill_artifact' AND r.external_id=$1 AND r.operation_tenant_id=$2
       ${scope.conditions.length ? `AND ${scope.conditions.join(" AND ")}` : ""} LIMIT 1`,
    [objectKey, ctx.tenantId, ...scope.params]
  );
  if (artifact.rows.length) return true;
  const result = await pool.query(
    `SELECT cs.id FROM chat_session cs JOIN users u ON u.id=cs.user_id
     JOIN chat_session_detail cd ON cd.session_id=cs.id
     WHERE cs.operation_tenant_id=$2
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(cd.attachments::jsonb,'[]'::jsonb)) a
         WHERE COALESCE(a->>'object_key',a->>'objectKey')=$1)
       ${scope.conditions.length ? `AND ${scope.conditions.join(" AND ")}` : ""} LIMIT 1`,
    [objectKey, ctx.tenantId, ...scope.params]
  );
  return result.rows.length > 0;
}
export async function requireWorkspaceObject(
  req: NextApiRequest,
  res: NextApiResponse,
  objectKey: string
) {
  const ctx = await requireWorkspaceTenant(req, res);
  if (!ctx) return null;
  if (ctx.enabled && !(await workspaceCanReadObject(ctx, objectKey))) {
    res.status(404).json({ error: "WORKSPACE_RESOURCE_NOT_FOUND" });
    return null;
  }
  return ctx;
}
