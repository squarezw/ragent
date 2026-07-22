import type { NextApiRequest, NextApiResponse } from "next";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { file_id } = req.query;
  if (!file_id) {
    res.status(400).json({ error: "Missing file_id" });
    return;
  }
  try {
    const client = await pool.connect();
    try {
      const dbRes = await client.query(
        "SELECT id, segment_index, segment_text, status FROM knowledge_segments WHERE file_id = $1 ORDER BY segment_index ASC",
        [file_id]
      );
      res.status(200).json({ segments: dbRes.rows });
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ error: "DB query failed", details: e });
  }
}
