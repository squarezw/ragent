import { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  canManageTenant,
  canManageDept,
  isSuperAdmin,
  getUserPermissions,
} from "@/lib/permissions";
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
          const { tenant_id } = req.query;
          let targetTenantId: number | string | string[] | undefined = tenant_id;

          // 确定目标租户ID
          const isSuper = await isSuperAdmin(userId);
          if (isSuper) {
            if (!targetTenantId) {
              // 超级管理员如果没有指定租户ID，返回所有部门的列表
              const allDeptsRes = await client.query(`
                SELECT d.id, d.tenant_id, d.parent_id, d.name, d.code, d.level, d.path, d.status, d.created_at, d.updated_at,
                       p.name as parent_name, t.name as tenant_name
                FROM dept d
                LEFT JOIN dept p ON d.parent_id = p.id
                LEFT JOIN tenant t ON d.tenant_id = t.id
                ORDER BY d.tenant_id, d.path, d.created_at
              `);
              return res.status(200).json({ depts: allDeptsRes.rows });
            }
          } else if (userPerms.tenantId) {
            // 租户管理员只能查看自己租户的部门
            targetTenantId = userPerms.tenantId;
          } else {
            // 普通用户没有租户时，返回空数组而不是 403
            return res.status(200).json({ depts: [] });
          }

          // 确保 targetTenantId 是数字
          const tenantId =
            typeof targetTenantId === "string"
              ? parseInt(targetTenantId)
              : Array.isArray(targetTenantId)
                ? parseInt(targetTenantId[0])
                : targetTenantId;

          if (!tenantId) {
            return res.status(400).json({ error: "无效的租户ID" });
          }

          // 获取部门列表
          const deptsRes = await client.query(
            `
            SELECT d.id, d.tenant_id, d.parent_id, d.name, d.code, d.level, d.path, d.status, d.created_at, d.updated_at,
                   p.name as parent_name
            FROM dept d
            LEFT JOIN dept p ON d.parent_id = p.id
            WHERE d.tenant_id = $1
            ORDER BY d.path, d.created_at
          `,
            [tenantId]
          );

          return res.status(200).json({ depts: deptsRes.rows });
        }

        case "POST": {
          const { name, code, parent_id, tenant_id: createTenantId } = req.body;

          if (!name || !code) {
            return res.status(400).json({ error: "部门名称和代码不能为空" });
          }

          // 确定目标租户ID
          let targetTenantIdForCreate = createTenantId;
          const isSuperForCreate = await isSuperAdmin(userId);
          if (isSuperForCreate) {
            if (!targetTenantIdForCreate) {
              return res.status(400).json({ error: "需要指定租户ID" });
            }
          } else if (userPerms.tenantId) {
            // 租户管理员只能在自己的租户下创建部门
            targetTenantIdForCreate = userPerms.tenantId;
          } else {
            return res.status(403).json({ error: "权限不足" });
          }

          // 检查权限
          if (!(await canManageTenant(userId, targetTenantIdForCreate))) {
            return res.status(403).json({ error: "没有权限在此租户下创建部门" });
          }

          // 检查部门代码是否已存在（在同一租户下）
          const existingCodeRes = await client.query(
            `
            SELECT id FROM dept WHERE code = $1 AND tenant_id = $2
          `,
            [code, targetTenantIdForCreate]
          );

          if (existingCodeRes.rows.length > 0) {
            return res.status(400).json({ error: "部门代码已存在" });
          }

          // 计算部门层级和路径
          let level = 1;
          let path = code;

          if (parent_id) {
            // 检查父部门是否存在且属于同一租户
            const parentDeptRes = await client.query(
              `
              SELECT level, path FROM dept WHERE id = $1 AND tenant_id = $2
            `,
              [parent_id, targetTenantIdForCreate]
            );

            if (parentDeptRes.rows.length === 0) {
              return res.status(400).json({ error: "父部门不存在" });
            }

            const parentDept = parentDeptRes.rows[0];
            level = parentDept.level + 1;
            path = `${parentDept.path}/${code}`;
          }

          // 创建部门
          const result = await client.query(
            `
            INSERT INTO dept (tenant_id, parent_id, name, code, level, path, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW())
            RETURNING id, tenant_id, parent_id, name, code, level, path, status, created_at, updated_at
          `,
            [targetTenantIdForCreate, parent_id, name, code, level, path]
          );

          return res.status(201).json({ dept: result.rows[0] });
        }

        case "PUT": {
          const {
            id: updateId,
            name: updateName,
            code: updateCode,
            parent_id: updateParentId,
            status: updateStatus,
          } = req.body;

          if (!updateId) {
            return res.status(400).json({ error: "部门ID不能为空" });
          }

          // 检查部门是否存在
          const existingDeptRes = await client.query(
            `
            SELECT tenant_id, parent_id FROM dept WHERE id = $1
          `,
            [updateId]
          );

          if (existingDeptRes.rows.length === 0) {
            return res.status(404).json({ error: "部门不存在" });
          }

          const existingDept = existingDeptRes.rows[0];
          const targetTenantIdForUpdate = existingDept.tenant_id;

          // 检查权限
          if (!(await canManageTenant(userId, targetTenantIdForUpdate))) {
            return res.status(403).json({ error: "没有权限修改此部门" });
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
            // 检查部门代码是否已存在（在同一租户下，排除当前部门）
            const codeCheckRes = await client.query(
              `
              SELECT id FROM dept WHERE code = $1 AND tenant_id = $2 AND id != $3
            `,
              [updateCode, targetTenantIdForUpdate, updateId]
            );

            if (codeCheckRes.rows.length > 0) {
              return res.status(400).json({ error: "部门代码已存在" });
            }

            updateFields.push(`code = $${paramIndex++}`);
            updateValues.push(updateCode);
          }

          if (updateStatus !== undefined) {
            updateFields.push(`status = $${paramIndex++}`);
            updateValues.push(updateStatus);
          }

          if (updateParentId !== undefined) {
            if (updateParentId === updateId) {
              return res.status(400).json({ error: "部门不能将自己设为父部门" });
            }

            // 检查是否形成循环引用
            if (updateParentId) {
              let currentParentId = updateParentId;
              while (currentParentId) {
                if (currentParentId === updateId) {
                  return res.status(400).json({ error: "不能形成循环引用" });
                }
                const parentRes = await client.query(
                  `
                  SELECT parent_id FROM dept WHERE id = $1
                `,
                  [currentParentId]
                );
                if (parentRes.rows.length === 0) break;
                currentParentId = parentRes.rows[0].parent_id;
              }
            }

            updateFields.push(`parent_id = $${paramIndex++}`);
            updateValues.push(updateParentId);
          }

          if (updateFields.length === 0) {
            return res.status(400).json({ error: "没有提供要更新的字段" });
          }

          // 更新部门
          updateValues.push(updateId);
          const updateResult = await client.query(
            `
            UPDATE dept 
            SET ${updateFields.join(", ")}, updated_at = NOW()
            WHERE id = $${paramIndex}
            RETURNING id, tenant_id, parent_id, name, code, level, path, status, created_at, updated_at
          `,
            updateValues
          );

          return res.status(200).json({ dept: updateResult.rows[0] });
        }

        case "DELETE": {
          const { id: deleteId } = req.query;

          if (!deleteId) {
            return res.status(400).json({ error: "部门ID不能为空" });
          }

          const deptId =
            typeof deleteId === "string"
              ? parseInt(deleteId)
              : Array.isArray(deleteId)
                ? parseInt(deleteId[0])
                : deleteId;

          // 检查部门是否存在
          const deleteDeptRes = await client.query(
            `
            SELECT tenant_id FROM dept WHERE id = $1
          `,
            [deptId]
          );

          if (deleteDeptRes.rows.length === 0) {
            return res.status(404).json({ error: "部门不存在" });
          }

          const deleteDept = deleteDeptRes.rows[0];
          const targetTenantIdForDelete = deleteDept.tenant_id;

          // 检查权限
          if (!(await canManageTenant(userId, targetTenantIdForDelete))) {
            return res.status(403).json({ error: "没有权限删除此部门" });
          }

          // 检查是否有子部门
          const childDeptRes = await client.query(
            `
            SELECT id FROM dept WHERE parent_id = $1
          `,
            [deptId]
          );

          if (childDeptRes.rows.length > 0) {
            return res.status(400).json({ error: "无法删除有子部门的部门，请先删除或移动子部门" });
          }

          // 删除部门
          await client.query(
            `
            DELETE FROM dept WHERE id = $1
          `,
            [deptId]
          );

          return res.status(200).json({ message: "部门删除成功" });
        }

        default:
          res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
          return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("部门管理 API 错误:", error);
    return res.status(500).json({ error: "服务器内部错误" });
  }
}
