import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  try {
    const { action, dataset_ids, file_ids } = req.body;

    if (!action || !["delete", "add_files", "remove_files"].includes(action)) {
      return res.status(400).json({ error: "无效的操作类型" });
    }

    if (!dataset_ids || !Array.isArray(dataset_ids) || dataset_ids.length === 0) {
      return res.status(400).json({ error: "数据集ID列表不能为空" });
    }

    const client = await pool.connect();
    try {
      if (action === "delete") {
        // 批量删除数据集
        // 首先检查用户是否有权限删除这些数据集
        const accessResult = await client.query(
          `
          SELECT d.id, d.user_id, d.owner_tenant_id
          FROM datasets d
          WHERE d.id = ANY($1::uuid[])
        `,
          [dataset_ids]
        );

        if (accessResult.rows.length !== dataset_ids.length) {
          return res.status(400).json({ error: "部分数据集不存在" });
        }

        // 检查权限
        for (const dataset of accessResult.rows) {
          const canAccess = await client.query("SELECT can_access_dataset($1, $2) as can_access", [
            userId,
            dataset.id,
          ]);

          if (!canAccess.rows[0]?.can_access) {
            return res.status(403).json({ error: `没有权限删除数据集: ${dataset.id}` });
          }

          // 只有数据集所有者或超级管理员可以删除
          if (dataset.user_id !== userId) {
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
            if (!userRoles.includes("超级管理员")) {
              return res
                .status(403)
                .json({ error: `只有数据集所有者可以删除数据集: ${dataset.id}` });
            }
          }
        }

        // 检查是否有数据集包含文件
        const fileCountResult = await client.query(
          `
          SELECT dataset_id, COUNT(*) as count 
          FROM knowledge_files 
          WHERE dataset_id = ANY($1::uuid[])
          GROUP BY dataset_id
        `,
          [dataset_ids]
        );

        const datasetsWithFiles = fileCountResult.rows.filter((row) => parseInt(row.count) > 0);
        if (datasetsWithFiles.length > 0) {
          return res.status(400).json({
            error: "以下数据集包含文件，无法删除",
            datasets: datasetsWithFiles.map((row) => ({
              dataset_id: row.dataset_id,
              file_count: parseInt(row.count),
            })),
          });
        }

        // 删除数据集
        const deleteResult = await client.query(
          `
          DELETE FROM datasets 
          WHERE id = ANY($1::uuid[])
          RETURNING id
        `,
          [dataset_ids]
        );

        res.json({
          message: `成功删除 ${deleteResult.rows.length} 个数据集`,
          deleted_count: deleteResult.rows.length,
        });
      } else if (action === "add_files") {
        // 批量添加文件到数据集
        if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
          return res.status(400).json({ error: "文件ID列表不能为空" });
        }

        if (dataset_ids.length > 1) {
          return res.status(400).json({ error: "添加文件时只能指定一个数据集" });
        }

        const datasetId = dataset_ids[0];

        // 检查用户是否有权限访问此数据集
        const accessResult = await client.query("SELECT can_access_dataset($1, $2) as can_access", [
          userId,
          datasetId,
        ]);

        if (!accessResult.rows[0]?.can_access) {
          return res.status(403).json({ error: "没有权限访问此数据集" });
        }

        // 验证数据集是否存在
        const datasetResult = await client.query("SELECT id FROM datasets WHERE id = $1", [
          datasetId,
        ]);

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
          [datasetId, fileIds]
        );

        res.json({
          message: `成功添加 ${result.rows.length} 个文件到数据集`,
          added_count: result.rows.length,
        });
      } else if (action === "remove_files") {
        // 批量从数据集移除文件
        if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
          return res.status(400).json({ error: "文件ID列表不能为空" });
        }

        if (dataset_ids.length > 1) {
          return res.status(400).json({ error: "移除文件时只能指定一个数据集" });
        }

        const datasetId = dataset_ids[0];

        // 检查用户是否有权限访问此数据集
        const accessResult = await client.query("SELECT can_access_dataset($1, $2) as can_access", [
          userId,
          datasetId,
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
          [fileIds, datasetId]
        );

        res.json({
          message: `成功从数据集移除 ${result.rows.length} 个文件`,
          removed_count: result.rows.length,
        });
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("批量操作数据集失败:", error);
    res.status(500).json({ error: "批量操作数据集失败" });
  }
}
