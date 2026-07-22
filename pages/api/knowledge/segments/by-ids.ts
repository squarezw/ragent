import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) {
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { segment_ids } = req.body;

  if (!segment_ids || !Array.isArray(segment_ids) || segment_ids.length === 0) {
    res.status(400).json({ error: "Missing or invalid segment_ids" });
    return;
  }

  try {
    const client = await pool.connect();
    try {
      // 查询指定 segment_ids 的详细信息，包括文件信息
      const sql = `
        SELECT 
          s.id,
          s.segment_index,
          s.segment_text,
          s.status,
          f.id as file_id,
          f.originalname,
          f.filename,
          f.mimetype,
          f.path
        FROM knowledge_segments s
        JOIN knowledge_files f ON s.file_id = f.id
        WHERE s.id = ANY($1::int[])
        ORDER BY s.id
      `;

      const dbRes = await client.query(sql, [segment_ids]);

      res.status(200).json({
        segments: dbRes.rows,
        count: dbRes.rows.length,
      });
    } finally {
      client.release();
    }
  } catch (e: any) {
    console.error("Error fetching segments by IDs:", e);
    res.status(500).json({ error: "Database query failed", details: e?.message || e });
  }
}
