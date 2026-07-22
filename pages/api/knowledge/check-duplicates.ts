import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * 检查同一数据集内是否存在同名文件
 * POST /api/knowledge/check-duplicates
 * Body: { filenames: string[], dataset_id: string }
 * Response: { duplicates: { [filename: string]: ExistingFile[] } }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { filenames, dataset_id } = req.body;

  if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
    return res.status(400).json({ error: "缺少文件名列表" });
  }

  if (!dataset_id) {
    return res.status(400).json({ error: "缺少数据集ID" });
  }

  try {
    const client = await pool.connect();
    try {
      // 构建查询条件 - 在指定数据集内查找同名文件
      const whereConditions = ["can_access_knowledge_file($1, kf.id)", "kf.dataset_id = $2"];
      const queryParams: any[] = [userId, dataset_id];

      // 文件名匹配（精确匹配）
      const filenamePlaceholders = filenames.map((_, i) => `$${i + 3}`).join(", ");
      whereConditions.push(`kf.originalname IN (${filenamePlaceholders})`);
      queryParams.push(...filenames);

      const whereClause = whereConditions.join(" AND ");

      // 查询匹配的文件
      const result = await client.query(
        `
        SELECT 
          kf.id,
          kf.filename,
          kf.originalname,
          kf.mimetype,
          kf.size,
          kf.upload_time,
          kf.status,
          kf.dataset_id,
          kf.user_id,
          u.nickname as uploader_name
        FROM knowledge_files kf
        LEFT JOIN users u ON kf.user_id = u.id
        WHERE ${whereClause}
        ORDER BY kf.upload_time DESC
      `,
        queryParams
      );

      // 按文件名分组
      const duplicates: { [filename: string]: any[] } = {};

      for (const row of result.rows) {
        const filename = row.originalname;
        if (!duplicates[filename]) {
          duplicates[filename] = [];
        }
        duplicates[filename].push({
          id: row.id,
          filename: row.filename,
          originalname: row.originalname,
          mimetype: row.mimetype,
          size: row.size,
          upload_time: row.upload_time,
          status: row.status,
          dataset_id: row.dataset_id,
          user_id: row.user_id,
          uploader_name: row.uploader_name,
        });
      }

      res.status(200).json({ duplicates });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("检查重复文件错误:", error);
    res.status(500).json({ error: "检查重复文件失败" });
  }
}
