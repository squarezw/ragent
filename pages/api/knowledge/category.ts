import { withKnowledgeWorkspace, knowledgeWorkspaceTenantId } from "@/lib/workspaceKnowledge";
import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await pool.connect();
    try {
      if (req.method === "GET") {
        const user_id = getUserIdFromRequest(req);
        if (!user_id) return res.status(401).json({ error: "未登录" });
        const dbRes = await client.query(
          `SELECT id, name FROM knowledge_category WHERE user_id = $1 ${knowledgeWorkspaceTenantId(req) === null ? "" : "AND owner_tenant_id=$2"} ORDER BY id ASC`,
          knowledgeWorkspaceTenantId(req) === null ? [user_id] : [user_id, knowledgeWorkspaceTenantId(req)]
        );
        res.status(200).json({ categories: dbRes.rows });
      } else if (req.method === "POST") {
        const user_id = getUserIdFromRequest(req);
        if (!user_id) return res.status(401).json({ error: "未登录" });
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: "Missing name" });
        const dbRes = await client.query(
          knowledgeWorkspaceTenantId(req) === null
            ? "INSERT INTO knowledge_category (name, created_at, user_id) VALUES ($1,NOW(),$2) RETURNING id,name,user_id"
            : "INSERT INTO knowledge_category (name, created_at, user_id, owner_tenant_id) VALUES ($1,NOW(),$2,$3) RETURNING id,name,user_id",
          knowledgeWorkspaceTenantId(req) === null ? [name,user_id] : [name,user_id,knowledgeWorkspaceTenantId(req)]
        );
        res.status(200).json({ category: dbRes.rows[0] });
      } else if (req.method === "PUT") {
        const { id, name } = req.body;
        if (!id || !name) return res.status(400).json({ error: "Missing id or name" });
        const dbRes = await client.query(
          "UPDATE knowledge_category SET name = $1 WHERE id = $2 RETURNING id, name",
          [name, id]
        );
        if (dbRes.rows.length === 0) return res.status(404).json({ error: "Category not found" });
        res.status(200).json({ category: dbRes.rows[0] });
      } else {
        res.status(405).json({ error: "Method not allowed" });
      }
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ error: "DB error", details: e });
  }
}

export default withKnowledgeWorkspace(handler, "category");
