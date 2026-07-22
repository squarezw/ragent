import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";
import { getUserPermissions, isSuperAdmin } from "@/lib/permissions";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

    // 获取筛选参数
    const filterTenantId = req.query.tenant_id ? parseInt(req.query.tenant_id as string, 10) : null;
    const filterDeptId = req.query.dept_id ? parseInt(req.query.dept_id as string, 10) : null;
    const filterUsername = req.query.username ? (req.query.username as string).trim() : null;

    const client = await pool.connect();
    try {
      let query = "";
      const params: any[] = [];
      let paramIndex = 1;

      // 根据用户角色确定可见的用户范围
      const isSuper = await isSuperAdmin(userId);

      // 构建WHERE条件
      const whereConditions: string[] = [];

      if (isSuper) {
        // 超级管理员可以看到所有用户，但需要应用筛选条件
        if (filterTenantId !== null) {
          whereConditions.push(`u.tenant_id = $${paramIndex}`);
          params.push(filterTenantId);
          paramIndex++;
        }
        if (filterDeptId !== null) {
          whereConditions.push(`u.dept_id = $${paramIndex}`);
          params.push(filterDeptId);
          paramIndex++;
        }
        // 用户名或昵称搜索（模糊匹配）
        if (filterUsername) {
          whereConditions.push(
            `(u.username ILIKE $${paramIndex} OR u.nickname ILIKE $${paramIndex})`
          );
          params.push(`%${filterUsername}%`);
          paramIndex++;
        }
      } else {
        // 检查当前用户是否是租户管理员
        const isTenantAdmin = userPerms.roles.some((role) => role.name === "租户管理员");
        const isDeptAdmin = userPerms.roles.some((role) => role.name === "部门管理员");

        if (isTenantAdmin && userPerms.tenantId) {
          // 租户管理员可以看到该租户下的所有用户，但不能看到超级管理员
          whereConditions.push(`u.tenant_id = $${paramIndex}`);
          params.push(userPerms.tenantId);
          paramIndex++;

          whereConditions.push(`NOT EXISTS (
            SELECT 1 FROM user_roles ur2 
            JOIN roles r2 ON ur2.role_id = r2.id 
            WHERE ur2.user_id = u.id AND r2.name = '超级管理员'
          )`);

          // 应用部门筛选
          if (filterDeptId !== null) {
            whereConditions.push(`u.dept_id = $${paramIndex}`);
            params.push(filterDeptId);
            paramIndex++;
          }
          // 用户名或昵称搜索（模糊匹配）
          if (filterUsername) {
            whereConditions.push(
              `(u.username ILIKE $${paramIndex} OR u.nickname ILIKE $${paramIndex})`
            );
            params.push(`%${filterUsername}%`);
            paramIndex++;
          }
        } else if (isDeptAdmin && userPerms.deptId) {
          // 部门管理员可以看到该部门下的所有用户，但不能看到超级管理员和租户管理员
          whereConditions.push(`u.dept_id = $${paramIndex}`);
          params.push(userPerms.deptId);
          paramIndex++;

          whereConditions.push(`NOT EXISTS (
            SELECT 1 FROM user_roles ur2 
            JOIN roles r2 ON ur2.role_id = r2.id 
            WHERE ur2.user_id = u.id AND (r2.name = '超级管理员' OR r2.name = '租户管理员')
          )`);

          // 用户名或昵称搜索（模糊匹配）
          if (filterUsername) {
            whereConditions.push(
              `(u.username ILIKE $${paramIndex} OR u.nickname ILIKE $${paramIndex})`
            );
            params.push(`%${filterUsername}%`);
            paramIndex++;
          }
        } else {
          // 普通用户只能看到自己
          whereConditions.push(`u.id = $${paramIndex}`);
          params.push(userId);
          paramIndex++;
        }
      }

      // 构建完整查询
      const whereClause =
        whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

      query = `
        SELECT u.id, u.username, u.nickname, u.email, u.tenant_id, u.dept_id, 
               u.status, u.created_at, u.wechat_id,
               t.name as tenant_name, d.name as dept_name,
               ARRAY_AGG(r.name) as roles
        FROM users u
        LEFT JOIN tenant t ON u.tenant_id = t.id
        LEFT JOIN dept d ON u.dept_id = d.id
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON ur.role_id = r.id
        ${whereClause}
        GROUP BY u.id, u.username, u.nickname, u.email, u.tenant_id, u.dept_id, 
                 u.status, u.created_at, u.wechat_id, t.name, d.name
        ORDER BY u.id ASC
      `;

      const result = await client.query(query, params);
      res.status(200).json({ users: result.rows });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("用户列表 API 错误:", err);
    res.status(500).json({ error: "Database error", details: err });
  }
}
