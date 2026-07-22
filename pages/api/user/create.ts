import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { getUserIdFromRequest } from "@/lib/auth";
import { canManageDept, isSuperAdmin, getUserPermissions } from "@/lib/permissions";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
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

    const { username, nickname, password, email, role, tenant_id, dept_id } = req.body;
    if (!username || !password || !email || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const client = await pool.connect();
    try {
      // 检查用户名和邮箱唯一性
      const exists = await client.query("SELECT 1 FROM users WHERE username=$1 OR email=$2", [
        username,
        email,
      ]);
      if (exists.rowCount && exists.rowCount > 0) {
        return res.status(409).json({ error: "Username or email already exists" });
      }

      // 确定目标租户和部门
      let targetTenantId = tenant_id;
      let targetDeptId = dept_id;

      const isSuper = await isSuperAdmin(userId);
      if (isSuper) {
        // 超级管理员可以创建任何租户的用户，也可以不指定租户
        // targetTenantId 和 targetDeptId 保持原值
      } else if (userPerms.tenantId) {
        // 租户管理员只能在自己的租户下创建用户
        targetTenantId = userPerms.tenantId;
        if (dept_id && !(await canManageDept(userId, dept_id))) {
          return res.status(403).json({ error: "没有权限在此部门下创建用户" });
        }
      } else if (userPerms.deptId) {
        // 部门管理员只能在自己的部门下创建用户
        targetTenantId = userPerms.tenantId;
        targetDeptId = userPerms.deptId;
      } else {
        return res.status(403).json({ error: "权限不足" });
      }

      // 验证租户和部门存在性
      if (targetTenantId) {
        const tenantExists = await client.query("SELECT 1 FROM tenant WHERE id = $1", [
          targetTenantId,
        ]);
        if (!tenantExists.rowCount || tenantExists.rowCount === 0) {
          return res.status(400).json({ error: "租户不存在" });
        }
      }

      if (targetDeptId) {
        const deptExists = await client.query(
          "SELECT 1 FROM dept WHERE id = $1 AND tenant_id = $2",
          [targetDeptId, targetTenantId]
        );
        if (!deptExists.rowCount || deptExists.rowCount === 0) {
          return res.status(400).json({ error: "部门不存在或不属于指定租户" });
        }
      }

      const hashed = await bcrypt.hash(password, 10);

      // 开始事务
      await client.query("BEGIN");

      try {
        // 创建用户
        const result = await client.query(
          `INSERT INTO users (username, nickname, password, email, tenant_id, dept_id, status, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW()) 
           RETURNING id, username, nickname, email, tenant_id, dept_id, status`,
          [username, nickname, hashed, email, targetTenantId, targetDeptId]
        );

        const newUserId = result.rows[0].id;

        // 根据角色名称分配角色
        const roleMap: { [key: string]: number } = {
          超级管理员: 1,
          租户管理员: 2,
          部门管理员: 3,
          普通用户: 4,
        };

        const roleId = roleMap[role];
        if (!roleId) {
          throw new Error("无效的角色名称");
        }

        // 分配角色
        await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [
          newUserId,
          roleId,
        ]);

        // 提交事务
        await client.query("COMMIT");

        // 返回用户信息（包含角色）
        const userWithRole = {
          ...result.rows[0],
          role: role,
        };

        res.status(201).json({ user: userWithRole });
      } catch (error) {
        // 回滚事务
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("创建用户 API 错误:", err);
    res.status(500).json({ error: "Database error", details: err });
  }
}
