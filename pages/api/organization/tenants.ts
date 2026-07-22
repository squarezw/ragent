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

    const client = await pool.connect();
    try {
      switch (req.method) {
        case "GET": {
          const isSuper = await isSuperAdmin(userId);

          if (isSuper) {
            // 超级管理员可以获取所有租户
            const tenantsRes = await client.query(`
              SELECT id, name, code, status, max_users, created_at, updated_at
              FROM tenant              
            `);
            return res.status(200).json({ tenants: tenantsRes.rows });
          } else if (userPerms.tenantId) {
            // 租户管理员只能获取自己的租户
            const tenantRes = await client.query(
              `
              SELECT id, name, code, status, max_users, created_at, updated_at
              FROM tenant
              WHERE id = $1
            `,
              [userPerms.tenantId]
            );

            if (tenantRes.rows.length === 0) {
              return res.status(200).json({ tenants: [] });
            }

            return res.status(200).json({ tenant: tenantRes.rows[0] });
          } else {
            // 普通用户没有租户时，返回空数组而不是 403
            return res.status(200).json({ tenants: [] });
          }
        }

        case "POST": {
          // 只有超级管理员可以创建租户
          if (!(await isSuperAdmin(userId))) {
            return res.status(403).json({ error: "只有超级管理员可以创建租户" });
          }

          const { name, code, max_users = 100 } = req.body;

          if (!name || !code) {
            return res.status(400).json({ error: "租户名称和代码不能为空" });
          }

          // 检查租户代码是否已存在
          const existingTenantRes = await client.query(
            `
            SELECT id FROM tenant WHERE code = $1
          `,
            [code]
          );

          if (existingTenantRes.rows.length > 0) {
            return res.status(400).json({ error: "租户代码已存在" });
          }

          // 创建租户
          const result = await client.query(
            `
            INSERT INTO tenant (name, code, status, max_users, created_at, updated_at)
            VALUES ($1, $2, 'active', $3, NOW(), NOW())
            RETURNING id, name, code, status, max_users, created_at, updated_at
          `,
            [name, code, max_users]
          );

          return res.status(201).json({ tenant: result.rows[0] });
        }

        case "PUT": {
          // 只有超级管理员可以更新租户
          if (!(await isSuperAdmin(userId))) {
            return res.status(403).json({ error: "只有超级管理员可以更新租户" });
          }

          const {
            id: updateId,
            name: updateName,
            code: updateCode,
            max_users: updateMaxUsers,
            status: updateStatus,
          } = req.body;

          if (!updateId) {
            return res.status(400).json({ error: "租户ID不能为空" });
          }

          // 检查租户是否存在
          const checkTenantRes = await client.query(
            `
            SELECT id FROM tenant WHERE id = $1
          `,
            [updateId]
          );

          if (checkTenantRes.rows.length === 0) {
            return res.status(404).json({ error: "租户不存在" });
          }

          // 构建更新字段
          const updateFields = [];
          const updateValues = [];
          let paramIndex = 1;

          if (updateName !== undefined) {
            updateFields.push(`name = $${paramIndex++}`);
            updateValues.push(updateName);
          }

          if (updateCode !== undefined) {
            // 检查租户代码是否已存在（排除当前租户）
            const codeCheckRes = await client.query(
              `
              SELECT id FROM tenant WHERE code = $1 AND id != $2
            `,
              [updateCode, updateId]
            );

            if (codeCheckRes.rows.length > 0) {
              return res.status(400).json({ error: "租户代码已存在" });
            }

            updateFields.push(`code = $${paramIndex++}`);
            updateValues.push(updateCode);
          }

          if (updateMaxUsers !== undefined) {
            updateFields.push(`max_users = $${paramIndex++}`);
            updateValues.push(updateMaxUsers);
          }

          if (updateStatus !== undefined) {
            updateFields.push(`status = $${paramIndex++}`);
            updateValues.push(updateStatus);
          }

          if (updateFields.length === 0) {
            return res.status(400).json({ error: "没有提供要更新的字段" });
          }

          // 更新租户
          updateValues.push(updateId);
          const updateResult = await client.query(
            `
            UPDATE tenant 
            SET ${updateFields.join(", ")}, updated_at = NOW()
            WHERE id = $${paramIndex}
            RETURNING id, name, code, status, max_users, created_at, updated_at
          `,
            updateValues
          );

          return res.status(200).json({ tenant: updateResult.rows[0] });
        }

        default:
          res.setHeader("Allow", ["GET", "POST", "PUT"]);
          return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("租户管理 API 错误:", error);
    return res.status(500).json({ error: "服务器内部错误" });
  }
}
