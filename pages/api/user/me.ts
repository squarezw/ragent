import type { NextApiRequest, NextApiResponse } from "next";
import { getUserPermissions } from "@/lib/permissions";
import { getUserIdFromRequest, getTokenFromRequest, setAuthCookie } from "@/lib/auth";
import { getCompanyCodeByTenantId } from "@/lib/tenantMapping";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    res.status(401).json({ error: "未登录" });
    return;
  }

  // 顺手把 cookie 续上：老的(仅 localStorage)会话首次加载即可获得 cookie，下载链接随后可用
  const token = getTokenFromRequest(req);
  if (token) setAuthCookie(res, token);

  try {
    const client = await pool.connect();
    try {
      // 获取用户基本信息
      const dbRes = await client.query(
        `
        SELECT u.id, u.username, u.nickname, u.email, u.tenant_id, u.dept_id, u.status, u.wechat_id, u.created_at, u.updated_at,
               t.name as tenant_name, d.name as dept_name
        FROM users u
        LEFT JOIN tenant t ON u.tenant_id = t.id
        LEFT JOIN dept d ON u.dept_id = d.id
        WHERE u.id = $1
      `,
        [userId]
      );

      if (dbRes.rows.length === 0) return res.status(404).json({ error: "用户不存在" });

      const user = dbRes.rows[0];

      // 获取用户权限信息
      const userPerms = await getUserPermissions(userId);

      // 构建响应数据
      const companyCode = user.tenant_id
        ? getCompanyCodeByTenantId(user.tenant_id)
        : undefined;
      const response = {
        ...user,
        company_code: companyCode || null,
        roles: userPerms?.roles || [],
        permissions: userPerms?.permissions || [],
        // 基于角色系统的权限字段
        isSuperAdmin: userPerms?.roles.some((role) => role.name === "超级管理员") || false,
        isTenantAdmin: userPerms?.roles.some((role) => role.name === "租户管理员") || false,
        isDeptAdmin: userPerms?.roles.some((role) => role.name === "部门管理员") || false,
        canManageOrg:
          userPerms?.roles.some(
            (role) => role.name === "超级管理员" || role.name === "租户管理员"
          ) || false,
        canManageStaff:
          userPerms?.roles.some(
            (role) =>
              role.name === "超级管理员" || role.name === "租户管理员" || role.name === "部门管理员"
          ) || false,
      };

      res.status(200).json(response);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("获取用户信息错误:", e);
    res.status(500).json({ error: "DB error", details: e });
  }
}
