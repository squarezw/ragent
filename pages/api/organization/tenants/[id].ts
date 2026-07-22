import { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { canManageTenant, isSuperAdmin, getUserPermissions } from "@/lib/permissions";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "未授权" });
    }

    // 获取用户权限信息
    const userPerms = await getUserPermissions(userId);
    if (!userPerms) {
      return res.status(404).json({ error: "用户不存在" });
    }

    const { id } = req.query;
    const tenantId =
      typeof id === "string" ? parseInt(id) : Array.isArray(id) ? parseInt(id[0]) : id;

    if (!tenantId || isNaN(tenantId)) {
      return res.status(400).json({ error: "无效的租户ID" });
    }

    const client = await pool.connect();
    try {
      switch (req.method) {
        case "GET": {
          const isSuper = await isSuperAdmin(userId);

          if (isSuper) {
            // 超级管理员可以获取任何租户
            const tenantRes = await client.query(
              `
              SELECT id, name, code, status, max_users, created_at, updated_at
              FROM tenant
              WHERE id = $1
            `,
              [tenantId]
            );

            if (tenantRes.rows.length === 0) {
              return res.status(404).json({ error: "租户不存在" });
            }

            return res.status(200).json({ tenant: tenantRes.rows[0] });
          } else if (userPerms.tenantId) {
            // 用户只能获取自己所属租户的信息
            if (userPerms.tenantId !== tenantId) {
              return res.status(403).json({ error: "无权限访问其他租户" });
            }

            const tenantRes = await client.query(
              `
              SELECT id, name, code, status, max_users, created_at, updated_at
              FROM tenant
              WHERE id = $1
            `,
              [tenantId]
            );

            if (tenantRes.rows.length === 0) {
              return res.status(404).json({ error: "租户不存在" });
            }

            return res.status(200).json({ tenant: tenantRes.rows[0] });
          } else {
            return res.status(403).json({ error: "权限不足" });
          }
        }

        case "PUT": {
          // 只有超级管理员可以更新租户
          if (!(await isSuperAdmin(userId))) {
            return res.status(403).json({ error: "只有超级管理员可以更新租户" });
          }

          const { name, code, max_users, status } = req.body;

          // 构建更新字段
          const updateFields = [];
          const updateValues = [];
          let paramIndex = 1;

          if (name !== undefined) {
            updateFields.push(`name = $${paramIndex++}`);
            updateValues.push(name);
          }

          if (code !== undefined) {
            // 检查租户代码是否已存在（排除当前租户）
            const existingTenantRes = await client.query(
              `
              SELECT id FROM tenant WHERE code = $1 AND id != $2
            `,
              [code, tenantId]
            );

            if (existingTenantRes.rows.length > 0) {
              return res.status(400).json({ error: "租户代码已存在" });
            }

            updateFields.push(`code = $${paramIndex++}`);
            updateValues.push(code);
          }

          if (max_users !== undefined) {
            updateFields.push(`max_users = $${paramIndex++}`);
            updateValues.push(max_users);
          }

          if (status !== undefined) {
            updateFields.push(`status = $${paramIndex++}`);
            updateValues.push(status);
          }

          if (updateFields.length === 0) {
            return res.status(400).json({ error: "没有提供要更新的字段" });
          }

          updateFields.push(`updated_at = NOW()`);
          updateValues.push(tenantId);

          const updateResult = await client.query(
            `
            UPDATE tenant 
            SET ${updateFields.join(", ")}
            WHERE id = $${paramIndex}
            RETURNING id, name, code, status, max_users, created_at, updated_at
          `,
            updateValues
          );

          if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: "租户不存在" });
          }

          return res.status(200).json({ tenant: updateResult.rows[0] });
        }

        case "DELETE": {
          // 只有超级管理员可以删除租户
          if (!(await isSuperAdmin(userId))) {
            return res.status(403).json({ error: "只有超级管理员可以删除租户" });
          }

          // 检查是否有用户属于该租户
          const usersRes = await client.query(
            `
            SELECT COUNT(*) as user_count FROM users WHERE tenant_id = $1
          `,
            [tenantId]
          );

          const userCount = parseInt(String(usersRes.rows[0]?.user_count || "0"), 10);
          if (userCount > 0) {
            return res.status(400).json({
              error: `无法删除有用户的租户，该租户下有 ${userCount} 个用户，请先删除或转移用户`,
            });
          }

          // 检查是否有部门属于该租户
          const deptsRes = await client.query(
            `
            SELECT COUNT(*) as dept_count FROM dept WHERE tenant_id = $1
          `,
            [tenantId]
          );

          const deptCount = parseInt(String(deptsRes.rows[0]?.dept_count || "0"), 10);
          if (deptCount > 0) {
            return res.status(400).json({
              error: `无法删除有部门的租户，该租户下有 ${deptCount} 个部门，请先删除部门`,
            });
          }

          // 检查是否有数据集（datasets）引用该租户（owner_tenant_id）
          // datasets 表有 owner_tenant_id 列和外键约束，需要处理
          const datasetsRes = await client.query(
            `
            SELECT COUNT(*) as dataset_count FROM datasets WHERE owner_tenant_id = $1
          `,
            [tenantId]
          );

          const datasetCount = parseInt(String(datasetsRes.rows[0]?.dataset_count || "0"), 10);
          if (datasetCount > 0) {
            // 将数据集的 owner_tenant_id 设为 NULL（因为这些数据集可能仍然有用）
            await client.query(
              `
              UPDATE datasets SET owner_tenant_id = NULL WHERE owner_tenant_id = $1
            `,
              [tenantId]
            );
          }

          // 检查是否有角色属于该租户（角色在删除租户时会被级联删除，但检查一下更安全）
          const rolesRes = await client.query(
            `
            SELECT COUNT(*) as role_count FROM roles WHERE tenant_id = $1
          `,
            [tenantId]
          );

          const roleCount = parseInt(String(rolesRes.rows[0]?.role_count || "0"), 10);

          // 删除租户（级联删除会自动处理部门和角色）
          const deleteResult = await client.query(
            `
            DELETE FROM tenant WHERE id = $1 RETURNING id
          `,
            [tenantId]
          );

          if (deleteResult.rows.length === 0) {
            return res.status(404).json({ error: "租户不存在" });
          }

          return res.status(200).json({ message: "租户删除成功" });
        }

        default:
          res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
          return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
      }
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("租户详情 API 错误:", error);
    console.error("错误详情:", {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
    });
    const errorMessage = error?.message || "服务器内部错误";
    const errorDetail =
      process.env.NODE_ENV === "development" ? `错误详情: ${errorMessage}` : "服务器内部错误";
    return res.status(500).json({ error: errorDetail });
  }
}
