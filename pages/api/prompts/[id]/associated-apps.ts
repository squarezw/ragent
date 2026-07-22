import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";
import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid prompt ID" });
  }

  try {
    const client = await pool.connect();

    try {
      // 查询关联了该提示词的应用
      const result = await client.query(
        `SELECT id, name, description, app_type, platform, created_at
         FROM apps 
         WHERE prompt_id = $1
         ORDER BY name`,
        [parseInt(id, 10)]
      );

      return res.status(200).json({
        count: result.rows.length,
        apps: result.rows,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error fetching associated apps:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
