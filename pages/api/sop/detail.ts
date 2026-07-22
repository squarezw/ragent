import type { NextApiRequest, NextApiResponse } from "next";
import { cleanText } from "@/lib/utils";
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
        // GET请求：所有登录用户都可以查看SOP详情
        const { subcategory_id } = req.query;
        let dbRes;
        if (subcategory_id) {
          dbRes = await client.query(
            "SELECT * FROM sop_detail WHERE subcategory_id = $1 ORDER BY step_number ASC",
            [subcategory_id]
          );
        } else {
          dbRes = await client.query("SELECT * FROM sop_detail ORDER BY id ASC");
        }
        res.status(200).json({ details: dbRes.rows });
      } else if (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") {
        if (req.method === "POST") {
          const { subcategory_id, step_number, image_url, content } = req.body;
          if (!subcategory_id || !step_number || !content)
            return res.status(400).json({ error: "Missing required fields" });
          const cleanedContent = cleanText(content);
          const dbRes = await client.query(
            "INSERT INTO sop_detail (subcategory_id, step_number, image_url, content, vector_status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *",
            [subcategory_id, step_number, image_url || null, cleanedContent, "pending"]
          );
          res.status(200).json({ detail: dbRes.rows[0] });
        } else if (req.method === "PUT") {
          const { id, step_number, image_url, content } = req.body;
          if (!id || !step_number || !content)
            return res.status(400).json({ error: "Missing required fields" });
          const dbRes = await client.query(
            "UPDATE sop_detail SET step_number = $1, image_url = $2, content = $3, updated_at = NOW() WHERE id = $4 RETURNING *",
            [step_number, image_url || null, content, id]
          );
          res.status(200).json({ detail: dbRes.rows[0] });
        } else if (req.method === "DELETE") {
          const { id } = req.body;
          if (!id) return res.status(400).json({ error: "Missing id" });
          await client.query("DELETE FROM sop_detail WHERE id = $1", [id]);
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
