import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PUT" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { id, originalname, visibility, tags, summary } = req.body;
  if (!id || (!originalname && !visibility && !tags && summary === undefined)) {
    return res.status(400).json({ error: "Missing id or update fields" });
  }

  try {
    const client = await pool.connect();
    try {
      // 检查用户是否有权限修改该文件
      const canModifyResult = await client.query(
        `
        SELECT user_id FROM knowledge_files WHERE id = $1
      `,
        [id]
      );

      if (canModifyResult.rows.length === 0) {
        return res.status(404).json({ error: "文件不存在" });
      }

      if (canModifyResult.rows[0].user_id !== userId) {
        // 检查用户是否是超级管理员或租户管理员
        const userRolesResult = await client.query(
          `
          SELECT array_agg(r.name) as roles
          FROM users u
          LEFT JOIN user_roles ur ON u.id = ur.user_id
          LEFT JOIN roles r ON ur.role_id = r.id
          WHERE u.id = $1
          GROUP BY u.id
        `,
          [userId]
        );

        const userRoles = userRolesResult.rows[0]?.roles || [];
        if (!userRoles.includes("超级管理员") && !userRoles.includes("租户管理员")) {
          return res.status(403).json({ error: "无权限修改该文件" });
        }
      }

      const setClauses = [];
      const values = [];
      let idx = 1;

      if (originalname) {
        setClauses.push(`originalname = $${idx++}`);
        values.push(originalname);
      }

      if (visibility) {
        setClauses.push(`visibility = $${idx++}`);
        values.push(visibility);
      }

      if (summary !== undefined) {
        setClauses.push(`summary = $${idx++}`);
        values.push(summary);
      }

      values.push(id);

      // 如果有其他字段需要更新，执行UPDATE
      if (setClauses.length > 0) {
        const sql = `UPDATE knowledge_files SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`;
        const dbRes = await client.query(sql, values);

        if (dbRes.rows.length === 0) {
          return res.status(404).json({ error: "文件不存在" });
        }
      } else {
        // 如果只是更新标签，需要验证文件是否存在
        const fileCheck = await client.query("SELECT id FROM knowledge_files WHERE id = $1", [id]);
        if (fileCheck.rows.length === 0) {
          return res.status(404).json({ error: "文件不存在" });
        }
      }

      // 如果更新了标签，需要处理文件标签关联
      if (tags && Array.isArray(tags)) {
        // 先删除现有的标签关联
        await client.query("DELETE FROM knowledge_file_tags WHERE file_id = $1", [id]);

        // 添加新的标签关联
        if (tags.length > 0) {
          const tagValues = tags
            .map((tagId: number, index: number) => `($1, $${index + 2})`)
            .join(", ");

          const tagParams = [id, ...tags];
          await client.query(
            `
            INSERT INTO knowledge_file_tags (file_id, tag_id) 
            VALUES ${tagValues}
          `,
            tagParams
          );
        }
      }

      // 返回成功响应
      res.status(200).json({ success: true });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("更新文件错误:", error);
    res.status(500).json({ error: "更新失败" });
  }
}
