import type { NextApiHandler, NextApiRequest } from "next";
import pool from "./db";
import { requireWorkspaceTenant, type WorkspaceContext } from "./workspaceTenant";

const contexts = new WeakMap<NextApiRequest, WorkspaceContext>();
export function knowledgeWorkspaceTenantId(req: NextApiRequest): number | null {
  return contexts.get(req)?.tenantId ?? null;
}
export function knowledgeWorkspaceContext(req: NextApiRequest): WorkspaceContext | undefined {
  return contexts.get(req);
}
type Resource = "dataset" | "file" | "segment" | "tag" | "category" | "none";
function ids(...values: unknown[]): string[] {
  return [...new Set(values.flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => typeof value === "string" || typeof value === "number")
    .map(value => String(value).trim()).filter(value => value !== "" && value !== "all"))];
}
/** Every requested resource is checked before the old handler, including bulk operations. */
export function withKnowledgeWorkspace(handler: NextApiHandler, resource: Resource = "none"): NextApiHandler {
  return async (req, res) => {
    try {
      const ctx = await requireWorkspaceTenant(req, res);
      if (!ctx) return;
      contexts.set(req, ctx);
      if (ctx.enabled) {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const query = req.query;
        if (body.owner_tenant_id != null && Number(body.owner_tenant_id) !== ctx.tenantId) {
          res.status(403).json({ error: "WORKSPACE_RESOURCE_FORBIDDEN" }); return;
        }
        const requested: Record<Resource, string[]> = {
          dataset: ids(query.dataset_id, query.datasetId, body.dataset_id, body.datasetId, body.dataset_ids),
          file: ids(query.file_id, query.fileId, body.file_id, body.fileId, body.file_ids,
            ...Object.values(body.replaceMap || {})),
          segment: ids(query.segment_id, body.segment_id, body.segment_ids),
          tag: ids(query.tag_id, body.tag_id, body.tag_ids, typeof body.tags === "string" ? body.tags.split(",") : body.tags),
          category: [], none: [],
        };
        if (resource !== "none") requested[resource] = ids(requested[resource], query.id, body.id);
        const sources: Record<Exclude<Resource,"none">, string> = {
          dataset: "SELECT d.id::text AS id FROM datasets d WHERE d.id::text = ANY($1::text[]) AND d.owner_tenant_id=$2 AND can_access_dataset($3,d.id)",
          file: "SELECT f.id::text AS id FROM knowledge_files f JOIN datasets d ON d.id=f.dataset_id WHERE f.id::text = ANY($1::text[]) AND d.owner_tenant_id=$2 AND can_access_dataset($3,d.id)",
          segment: "SELECT s.id::text AS id FROM knowledge_segments s JOIN knowledge_files f ON f.id=s.file_id JOIN datasets d ON d.id=f.dataset_id WHERE s.id::text = ANY($1::text[]) AND d.owner_tenant_id=$2 AND can_access_dataset($3,d.id)",
          tag: "SELECT id::text AS id FROM knowledge_tags WHERE id::text = ANY($1::text[]) AND owner_tenant_id=$2 AND $3::bigint IS NOT NULL",
          category: "SELECT id::text AS id FROM knowledge_category WHERE id::text = ANY($1::text[]) AND owner_tenant_id=$2 AND user_id=$3",
        };
        // Shared knowledge is readable across tenants, never writable through this exception.
        if (req.method === "GET" || req.method === "HEAD") {
          for (const kind of ["dataset", "file", "segment"] as const) {
            sources[kind] = sources[kind].replace(
              "d.owner_tenant_id=$2",
              "(d.owner_tenant_id=$2 OR d.visibility='public')"
            ).replace("can_access_dataset($3,d.id)", "(can_access_dataset($3,d.id) OR d.visibility='public')");
          }
        }
        for (const kind of Object.keys(sources) as Exclude<Resource,"none">[]) {
          const values = requested[kind];
          if (!values.length) continue;
          const result = await pool.query(sources[kind], [values, ctx.tenantId, ctx.actorUserId]);
          if (result.rows.length !== values.length) {
            res.status(404).json({ error: "WORKSPACE_RESOURCE_NOT_FOUND" }); return;
          }
        }
      }
      return await handler(req,res);
    } catch {
      if (!res.headersSent) res.status(503).json({ error: "WORKSPACE_SCOPE_UNAVAILABLE" });
    } finally {
      contexts.delete(req);
    }
  };
}
