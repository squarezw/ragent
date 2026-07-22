import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { dataset_id } = req.query;

  try {
    const client = await pool.connect();
    try {
      console.log("Tags summary API called with:", { userId, dataset_id });

      // 获取用户可访问文件的所有标签汇总
      let query: string;
      let params: any[];

      if (dataset_id) {
        // 有dataset_id时的查询 - 返回该dataset下所有可用的标签
        query = `
          SELECT 
            kt.id,
            kt.name,
            kt.color,
            COUNT(DISTINCT kf.id) as file_count
          FROM knowledge_files kf
          LEFT JOIN knowledge_file_tags kft ON kf.id = kft.file_id
          LEFT JOIN knowledge_tags kt ON kft.tag_id = kt.id
          WHERE kf.dataset_id = $1 AND kt.id IS NOT NULL
          GROUP BY kt.id, kt.name, kt.color
          ORDER BY file_count DESC, kt.name
        `;
        params = [dataset_id];
        console.log("Using LEFT JOIN with NULL filter dataset query with params:", params);
      } else {
        // 没有dataset_id时的查询 - 只返回有标签的文件
        query = `
          SELECT 
            kt.id,
            kt.name,
            kt.color,
            COUNT(DISTINCT kf.id) as file_count
          FROM knowledge_files kf
          INNER JOIN knowledge_file_tags kft ON kf.id = kft.file_id
          INNER JOIN knowledge_tags kt ON kft.tag_id = kt.id
          WHERE can_access_knowledge_file($1, kf.id)
          GROUP BY kt.id, kt.name, kt.color
          ORDER BY file_count DESC, kt.name
        `;
        params = [userId];
        console.log("Using INNER JOIN general query with params:", params);
      }

      const result = await client.query(query, params);

      const tags = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        file_count: parseInt(row.file_count),
      }));

      res.status(200).json({ tags });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("获取标签汇总错误:", error);
    res.status(500).json({ error: "获取标签汇总失败" });
  }
}
