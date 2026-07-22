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

  try {
    const { q, page = "1", page_size = "20" } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const pageSize = parseInt(page_size as string) || 20;
    const offset = (pageNum - 1) * pageSize;

    const client = await pool.connect();
    try {
      let whereClause = "WHERE can_access_dataset($1, d.id)";
      const params: any[] = [userId];
      let paramIndex = 2;

      if (q && typeof q === "string" && q.trim()) {
        whereClause += ` AND d.name ILIKE $${paramIndex}`;
        params.push(`%${q.trim()}%`);
        paramIndex++;
      }

      // 获取搜索结果
      const result = await client.query(
        `
        SELECT 
          d.id,
          d.name,
          d.settings,
          d.created_at,
          d.updated_at,
          d.visibility,
          d.owner_dept_id,
          d.owner_tenant_id,
          d.user_id,
          dept.name as owner_dept_name,
          tenant.name as owner_tenant_name,
          u.nickname as owner_name,
          COUNT(kf.id) as file_count
        FROM datasets d
        LEFT JOIN dept ON d.owner_dept_id = dept.id
        LEFT JOIN tenant ON d.owner_tenant_id = tenant.id
        LEFT JOIN users u ON d.user_id = u.id
        LEFT JOIN knowledge_files kf ON d.id = kf.dataset_id
        ${whereClause}
        GROUP BY 
          d.id, d.name, d.settings, d.created_at, d.updated_at,
          d.visibility, d.owner_dept_id, d.owner_tenant_id, d.user_id,
          dept.name, tenant.name, u.nickname
        ORDER BY 
          CASE WHEN $${paramIndex} IS NOT NULL THEN 
            CASE WHEN d.name ILIKE $${paramIndex} THEN 1 ELSE 2 END 
          ELSE 3 END,
          d.created_at DESC
        LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
      `,
        [...params, q, pageSize, offset]
      );

      // 获取总数
      const countResult = await client.query(
        `
        SELECT COUNT(DISTINCT d.id) as total
        FROM datasets d
        ${whereClause}
      `,
        params
      );

      const total = parseInt(countResult.rows[0]?.total || "0");
      const totalPages = Math.ceil(total / pageSize);

      res.json({
        datasets: result.rows,
        pagination: {
          page: pageNum,
          page_size: pageSize,
          total,
          total_pages: totalPages,
          has_next: pageNum < totalPages,
          has_prev: pageNum > 1,
        },
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("搜索数据集失败:", error);
    res.status(500).json({ error: "搜索数据集失败" });
  }
}
