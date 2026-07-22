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
          // 获取文件的标签
          const { file_id } = req.query;
          if (!file_id) {
            return res.status(400).json({ error: "文件ID不能为空" });
          }

          // 检查用户是否有权限访问该文件
          const accessResult = await client.query(
            `
            SELECT can_access_knowledge_file($1, $2) as can_access
          `,
            [userId, file_id]
          );

          if (!accessResult.rows[0].can_access) {
            return res.status(403).json({ error: "无权限访问该文件" });
          }

          const tagsResult = await client.query(
            `
            SELECT kt.id, kt.name, kt.color
            FROM knowledge_file_tags kft
            JOIN knowledge_tags kt ON kft.tag_id = kt.id
            WHERE kft.file_id = $1
            ORDER BY kt.name
          `,
            [file_id]
          );

          res.status(200).json({ tags: tagsResult.rows });
          break;
        }

        case "POST": {
          // 为文件添加标签
          const { file_id: addFileId, tag_ids } = req.body;
          if (!addFileId || !tag_ids || !Array.isArray(tag_ids)) {
            return res.status(400).json({ error: "文件ID和标签ID列表不能为空" });
          }

          // 检查用户是否有权限修改该文件
          const canModifyResult = await client.query(
            `
            SELECT user_id FROM knowledge_files WHERE id = $1
          `,
            [addFileId]
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

          // 删除现有标签
          await client.query(
            `
            DELETE FROM knowledge_file_tags WHERE file_id = $1
          `,
            [addFileId]
          );

          // 添加新标签
          if (tag_ids.length > 0) {
            const insertValues = tag_ids
              .map((tagId: number, index: number) => `($${index * 2 + 1}, $${index * 2 + 2})`)
              .join(", ");

            const insertQuery = `
              INSERT INTO knowledge_file_tags (file_id, tag_id)
              VALUES ${insertValues}
            `;

            const insertParams = tag_ids.flatMap((tagId: number) => [addFileId, tagId]);
            await client.query(insertQuery, insertParams);
          }

          res.status(200).json({ message: "标签更新成功" });
          break;
        }

        case "DELETE": {
          // 删除文件的标签
          const { file_id: deleteFileId, tag_id } = req.query;
          if (!deleteFileId || !tag_id) {
            return res.status(400).json({ error: "文件ID和标签ID不能为空" });
          }

          // 检查用户是否有权限修改该文件
          const canDeleteResult = await client.query(
            `
            SELECT user_id FROM knowledge_files WHERE id = $1
          `,
            [deleteFileId]
          );

          if (canDeleteResult.rows.length === 0) {
            return res.status(404).json({ error: "文件不存在" });
          }

          if (canDeleteResult.rows[0].user_id !== userId) {
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

          await client.query(
            `
            DELETE FROM knowledge_file_tags 
            WHERE file_id = $1 AND tag_id = $2
          `,
            [deleteFileId, tag_id]
          );

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
    console.error("文件标签操作错误:", error);
    res.status(500).json({ error: "操作失败" });
  }
}
