import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 检查用户登录
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "未登录" });
    }

    const client = await pool.connect();
    try {
      if (req.method === "GET") {
        // GET请求：所有登录用户都可以查看SOP子类
        const { category_id } = req.query;
        let dbRes;
        if (category_id) {
          dbRes = await client.query(
            "SELECT id, category_id, name, vector_status, embedding_model, type FROM sop_subcategory WHERE category_id = $1 ORDER BY id ASC",
            [category_id]
          );
        } else {
          dbRes = await client.query(
            "SELECT id, category_id, name, vector_status, embedding_model, type FROM sop_subcategory ORDER BY id ASC"
          );
        }

        res.status(200).json({ subcategories: dbRes.rows });
      } else if (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") {
        if (req.method === "POST") {
          const { category_id, name, type = "process" } = req.body;
          if (!category_id || !name)
            return res.status(400).json({ error: "Missing category_id or name" });
          const dbRes = await client.query(
            "INSERT INTO sop_subcategory (category_id, name, type) VALUES ($1, $2, $3) RETURNING *",
            [category_id, name, type]
          );
          res.status(200).json({ subcategory: dbRes.rows[0] });
        } else if (req.method === "PUT") {
          const { id, name, type } = req.body;
          if (!id || !name) return res.status(400).json({ error: "Missing id or name" });
          const updateFields = ["name = $1"];
          const params = [name];
          if (type) {
            updateFields.push("type = $2");
            params.push(type);
          }
          params.push(id);
          const dbRes = await client.query(
            `UPDATE sop_subcategory SET ${updateFields.join(", ")} WHERE id = $${params.length} RETURNING *`,
            params
          );
          res.status(200).json({ subcategory: dbRes.rows[0] });
        } else if (req.method === "DELETE") {
          const { id } = req.body;
          if (!id) return res.status(400).json({ error: "Missing id" });
          await client.query("DELETE FROM sop_subcategory WHERE id = $1", [id]);
          res.status(200).json({ success: true });
        }
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
