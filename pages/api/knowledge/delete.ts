import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";
import { ossClient } from "@/lib/ossClient";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "DELETE") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = req.query.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }

  try {
    const client = await pool.connect();
    try {
      // 查找文件记录和文件创建者的租户信息
      // knowledge_files 表只有 user_id，需要通过 JOIN 从 users 表获取租户信息
      const dbRes = await client.query(
        `
        SELECT kf.user_id, 
               u_file.tenant_id as file_tenant_id
        FROM knowledge_files kf
        LEFT JOIN users u_file ON kf.user_id = u_file.id
        WHERE kf.id = $1
      `,
        [id]
      );

      if (dbRes.rows.length === 0) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const file = dbRes.rows[0];
      const fileOwnerId = file.user_id;
      const fileTenantId = file.file_tenant_id;

      // 检查用户是否有权限删除该文件
      if (fileOwnerId !== userId) {
        // 检查用户是否是超级管理员或租户管理员
        const userRolesResult = await client.query(
          `
          SELECT u.tenant_id,
                 array_agg(r.name) as roles
          FROM users u
          LEFT JOIN user_roles ur ON u.id = ur.user_id
          LEFT JOIN roles r ON ur.role_id = r.id
          WHERE u.id = $1
          GROUP BY u.id, u.tenant_id
        `,
          [userId]
        );

        if (userRolesResult.rows.length === 0) {
          return res
            .status(403)
            .json({
              error: "Only the file owner, super admin, or tenant admin can delete this file",
            });
        }

        const user = userRolesResult.rows[0];
        const userRoles = user.roles || [];
        const userTenantId = user.tenant_id;

        // 超级管理员可以删除所有文件
        if (userRoles.includes("超级管理员")) {
          // 允许删除
        }
        // 租户管理员可以删除同租户内的文件
        else if (
          userRoles.includes("租户管理员") &&
          fileTenantId &&
          userTenantId === fileTenantId
        ) {
          // 允许删除
        } else {
          return res
            .status(403)
            .json({
              error: "Only the file owner, super admin, or tenant admin can delete this file",
            });
        }
      }

      // 获取文件信息（用于删除 OSS 文件）
      const fullFileRes = await client.query(
        "SELECT object_key FROM knowledge_files WHERE id = $1",
        [id]
      );
      const fullFile = fullFileRes.rows[0];

      // 删除分段
      await client.query("DELETE FROM knowledge_segments WHERE file_id = $1", [id]);
      // 删除文件记录
      await client.query("DELETE FROM knowledge_files WHERE id = $1", [id]);
      // 删除 OSS 文件
      if (fullFile.object_key) {
        try {
          await ossClient.delete({ objectKey: fullFile.object_key });
        } catch (ossErr) {
          console.error("[Delete] Failed to delete OSS file:", ossErr);
        }
      }
      res.status(200).json({ success: true });
    } finally {
      client.release();
    }
  } catch (e: any) {
    res.status(500).json({ error: "Delete failed", details: e?.message || e });
  }
}
