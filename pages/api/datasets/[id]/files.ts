import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "数据集ID不能为空" });
  }

  if (req.method === "GET") {
    // 获取数据集中的文件列表
    try {
      const client = await pool.connect();
      try {
        // 首先检查用户是否有权限访问此数据集
        const accessResult = await client.query("SELECT can_access_dataset($1, $2) as can_access", [
          userId,
          id,
        ]);

        if (!accessResult.rows[0]?.can_access) {
          return res.status(403).json({ error: "没有权限访问此数据集" });
        }

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
            kf.user_id,
            u.nickname as uploader_name
          FROM knowledge_files kf
          LEFT JOIN users u ON kf.user_id = u.id
          WHERE kf.dataset_id = $1
          ORDER BY kf.upload_time DESC
        `,
          [id]
        );

        res.json(result.rows);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("获取数据集文件列表失败:", error);
      res.status(500).json({ error: "获取数据集文件列表失败" });
    }
  } else if (req.method === "POST") {
    // 向数据集添加文件
    try {
      const { file_ids } = req.body;

      if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
        return res.status(400).json({ error: "文件ID列表不能为空" });
      }

      const client = await pool.connect();
      try {
        // 检查用户是否有权限访问此数据集
        const accessResult = await client.query("SELECT can_access_dataset($1, $2) as can_access", [
          userId,
          id,
        ]);

        if (!accessResult.rows[0]?.can_access) {
          return res.status(403).json({ error: "没有权限访问此数据集" });
        }

        // 验证数据集是否存在
        const datasetResult = await client.query("SELECT id FROM datasets WHERE id = $1", [id]);

        if (datasetResult.rows.length === 0) {
          return res.status(404).json({ error: "数据集不存在" });
        }

        // 验证文件是否存在且可访问
        const fileIds = file_ids.map((id: any) => parseInt(id)).filter((id) => !isNaN(id));
        if (fileIds.length === 0) {
          return res.status(400).json({ error: "无效的文件ID" });
        }

        // 检查用户是否有权限访问这些文件
        for (const fileId of fileIds) {
          const fileAccessResult = await client.query(
            "SELECT can_access_knowledge_file($1, $2) as can_access",
            [userId, fileId]
          );

          if (!fileAccessResult.rows[0]?.can_access) {
            return res.status(403).json({ error: `没有权限访问文件: ${fileId}` });
          }
        }

        // 更新文件的dataset_id
        const result = await client.query(
          `
          UPDATE knowledge_files 
          SET dataset_id = $1
          WHERE id = ANY($2::int[])
          RETURNING id
        `,
          [id, fileIds]
        );

        res.json({
          message: `成功添加 ${result.rows.length} 个文件到数据集`,
          added_count: result.rows.length,
        });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("添加文件到数据集失败:", error);
      res.status(500).json({ error: "添加文件到数据集失败" });
    }
  } else if (req.method === "DELETE") {
    // 从数据集移除文件
    try {
      const { file_ids } = req.body;

      if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
        return res.status(400).json({ error: "文件ID列表不能为空" });
      }

      const client = await pool.connect();
      try {
        // 检查用户是否有权限访问此数据集
        const accessResult = await client.query("SELECT can_access_dataset($1, $2) as can_access", [
          userId,
          id,
        ]);

        if (!accessResult.rows[0]?.can_access) {
          return res.status(403).json({ error: "没有权限访问此数据集" });
        }

        const fileIds = file_ids.map((id: any) => parseInt(id)).filter((id) => !isNaN(id));
        if (fileIds.length === 0) {
          return res.status(400).json({ error: "无效的文件ID" });
        }

        // 从数据集移除文件
        const result = await client.query(
          `
          UPDATE knowledge_files 
          SET dataset_id = NULL
          WHERE id = ANY($1::int[]) AND dataset_id = $2
          RETURNING id
        `,
          [fileIds, id]
        );

        res.json({
          message: `成功从数据集移除 ${result.rows.length} 个文件`,
          removed_count: result.rows.length,
        });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("从数据集移除文件失败:", error);
      res.status(500).json({ error: "从数据集移除文件失败" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
