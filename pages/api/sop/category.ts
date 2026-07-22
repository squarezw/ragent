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
        // GET请求：所有登录用户都可以查看SOP分类
        const dbRes = await client.query("SELECT id, name FROM sop_category ORDER BY id ASC");
        res.status(200).json({ categories: dbRes.rows });
      } else if (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") {
        if (req.method === "POST") {
          const { name } = req.body;
          if (!name) return res.status(400).json({ error: "Missing name" });
          const dbRes = await client.query(
            "INSERT INTO sop_category (name) VALUES ($1) RETURNING *",
            [name]
          );
          res.status(200).json({ category: dbRes.rows[0] });
        } else if (req.method === "PUT") {
          const { id, name } = req.body;
          if (!id || !name) return res.status(400).json({ error: "Missing id or name" });
          const dbRes = await client.query(
            "UPDATE sop_category SET name = $1 WHERE id = $2 RETURNING *",
            [name, id]
          );
          res.status(200).json({ category: dbRes.rows[0] });
        } else if (req.method === "DELETE") {
          const { id } = req.body;
          if (!id) return res.status(400).json({ error: "Missing id" });
          await client.query("DELETE FROM sop_category WHERE id = $1", [id]);
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
