import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  try {
    const client = await pool.connect();
    try {
      switch (req.method) {
        case "GET": {
          // 获取所有标签
          const result = await client.query(`
            SELECT id, name, color, created_at, updated_at
            FROM knowledge_tags
            ORDER BY name
          `);
          res.status(200).json({ tags: result.rows });
          break;
        }

        case "POST": {
          // 创建新标签
          const { name, color = "#3b82f6" } = req.body;
          if (!name || !name.trim()) {
            return res.status(400).json({ error: "标签名称不能为空" });
          }

          const insertResult = await client.query(
            `
            INSERT INTO knowledge_tags (name, color)
            VALUES ($1, $2)
            RETURNING id, name, color, created_at, updated_at
          `,
            [name.trim(), color]
          );

          res.status(201).json({ tag: insertResult.rows[0] });
          break;
        }

        case "PUT": {
          // 更新标签
          const { id, name: updateName, color: updateColor } = req.body;
          if (!id || !updateName || !updateName.trim()) {
            return res.status(400).json({ error: "标签ID和名称不能为空" });
          }

          const updateResult = await client.query(
            `
            UPDATE knowledge_tags
            SET name = $1, color = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING id, name, color, created_at, updated_at
          `,
            [updateName.trim(), updateColor || "#3b82f6", id]
          );

          if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: "标签不存在" });
          }

          res.status(200).json({ tag: updateResult.rows[0] });
          break;
        }

        case "DELETE": {
          // 删除标签
          const { id: deleteId } = req.query;
          if (!deleteId) {
            return res.status(400).json({ error: "标签ID不能为空" });
          }

          // 检查标签是否被使用
          const usageResult = await client.query(
            `
            SELECT COUNT(*) as count
            FROM knowledge_file_tags
            WHERE tag_id = $1
          `,
            [deleteId]
          );

          if (parseInt(usageResult.rows[0].count) > 0) {
            return res.status(400).json({ error: "标签正在使用中，无法删除" });
          }

          const deleteResult = await client.query(
            `
            DELETE FROM knowledge_tags
            WHERE id = $1
            RETURNING id
          `,
            [deleteId]
          );

          if (deleteResult.rows.length === 0) {
            return res.status(404).json({ error: "标签不存在" });
          }

          res.status(200).json({ message: "标签删除成功" });
          break;
        }

        default:
          res.status(405).json({ error: "Method not allowed" });
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("标签操作错误:", error);
    res.status(500).json({ error: "操作失败" });
  }
}
