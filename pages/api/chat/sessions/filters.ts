import { NextApiRequest, NextApiResponse } from "next";
import pool from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth";
import { getUserPermissions, isSuperAdmin, isTenantAdmin, isDeptAdmin } from "@/lib/permissions";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 认证检查
  const currentUserId = getUserIdFromRequest(req);
  if (!currentUserId) {
    return res.status(401).json({ error: "未登录" });
  }

  try {
    // 获取当前用户权限信息
    const userPerms = await getUserPermissions(currentUserId);
    if (!userPerms) {
      return res.status(404).json({ error: "用户不存在" });
    }

    // 检查用户角色
    const superAdmin = await isSuperAdmin(currentUserId);
    const tenantAdmin = await isTenantAdmin(currentUserId);
    const deptAdmin = await isDeptAdmin(currentUserId);

    // 获取查询参数中的租户ID（用于过滤用户和部门）
    const filterTenantId = req.query.tenantId ? Number(req.query.tenantId) : null;

    // 如果提供了租户ID，验证权限（只有超级管理员可以按租户过滤）
    if (filterTenantId !== null && !superAdmin) {
      return res.status(403).json({ error: "无权按租户过滤" });
    }

    // 构建权限过滤条件
    const userWhereConditions = ["u.status = 'active'"];
    const deptWhereConditions = ["status = 'active'"];
    const statsWhereConditions: string[] = [];
    const userQueryParams: any[] = [];
    const deptQueryParams: any[] = [];
    const statsQueryParams: any[] = [];
    let userParamIndex = 1;
    let deptParamIndex = 1;
    let statsParamIndex = 1;

    // 如果提供了租户ID，优先使用租户ID过滤
    if (filterTenantId !== null) {
      userWhereConditions.push(`u.tenant_id = $${userParamIndex}`);
      userQueryParams.push(filterTenantId);
      userParamIndex++;

      deptWhereConditions.push(`tenant_id = $${deptParamIndex}`);
      deptQueryParams.push(filterTenantId);
      deptParamIndex++;

      statsWhereConditions.push(`u.tenant_id = $${statsParamIndex}`);
      statsQueryParams.push(filterTenantId);
      statsParamIndex++;
    } else if (!superAdmin) {
      // 根据角色添加权限过滤（仅在未指定租户时）
      if (tenantAdmin && userPerms.tenantId) {
        // 租户管理员：只能看到本租户下的数据
        userWhereConditions.push(`u.tenant_id = $${userParamIndex}`);
        userQueryParams.push(userPerms.tenantId);
        userParamIndex++;

        deptWhereConditions.push(`tenant_id = $${deptParamIndex}`);
        deptQueryParams.push(userPerms.tenantId);
        deptParamIndex++;

        statsWhereConditions.push(`u.tenant_id = $${statsParamIndex}`);
        statsQueryParams.push(userPerms.tenantId);
        statsParamIndex++;
      } else if (deptAdmin && userPerms.deptId) {
        // 部门管理员：只能看到本部门下的数据
        userWhereConditions.push(`u.dept_id = $${userParamIndex}`);
        userQueryParams.push(userPerms.deptId);
        userParamIndex++;

        deptWhereConditions.push(`id = $${deptParamIndex}`);
        deptQueryParams.push(userPerms.deptId);
        deptParamIndex++;

        statsWhereConditions.push(`u.dept_id = $${statsParamIndex}`);
        statsQueryParams.push(userPerms.deptId);
        statsParamIndex++;
      } else {
        // 普通用户：只能看到自己的数据
        userWhereConditions.push(`u.id = $${userParamIndex}`);
        userQueryParams.push(currentUserId);
        userParamIndex++;

        statsWhereConditions.push(`cs.user_id = $${statsParamIndex}`);
        statsQueryParams.push(currentUserId);
        statsParamIndex++;
      }
    }

    const userWhereClause = `WHERE ${userWhereConditions.join(" AND ")}`;
    const deptWhereClause = `WHERE ${deptWhereConditions.join(" AND ")}`;
    const statsWhereClause =
      statsWhereConditions.length > 0 ? `WHERE ${statsWhereConditions.join(" AND ")}` : "";

    // 获取用户列表
    const usersQuery = `
      SELECT 
        u.id,
        u.nickname,
        u.username,
        u.email,
        d.name as dept_name
      FROM users u
      LEFT JOIN dept d ON u.dept_id = d.id
      ${userWhereClause}
      ORDER BY u.nickname, u.username
    `;

    const usersResult = await pool.query(usersQuery, userQueryParams);

    // 获取部门列表
    const deptsQuery = `
      SELECT 
        id,
        name,
        code,
        level,
        path
      FROM dept
      ${deptWhereClause}
      ORDER BY level, sort_order, name
    `;

    const deptsResult = await pool.query(deptsQuery, deptQueryParams);

    // 获取租户列表（只有超级管理员可以看到所有租户）
    let tenantsResult;
    if (superAdmin) {
      const tenantsQuery = `
        SELECT 
          id,
          name,
          code,
          status
        FROM tenant
        WHERE status = 'active'
        ORDER BY name
      `;
      tenantsResult = await pool.query(tenantsQuery);
    } else {
      tenantsResult = { rows: [] };
    }

    // 获取会话统计（需要 JOIN users 表以应用权限过滤）
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT cs.id) as total_sessions,
        COUNT(DISTINCT cs.user_id) as total_users,
        AVG(csd.duration_ms) as avg_duration,
        SUM(CASE WHEN csd.vote_good = true THEN 1 ELSE 0 END) as total_good_votes,
        SUM(CASE WHEN csd.vote_bad = true THEN 1 ELSE 0 END) as total_bad_votes,
        SUM(CASE WHEN csd.answer IS NULL OR csd.answer = '' THEN 1 ELSE 0 END) as total_unanswered_questions
      FROM chat_session cs
      LEFT JOIN users u ON cs.user_id = u.id
      LEFT JOIN chat_session_detail csd ON cs.id = csd.session_id
      ${statsWhereClause}
    `;

    const statsResult = await pool.query(statsQuery, statsQueryParams);

    const filters = {
      users: usersResult.rows.map((user) => ({
        id: user.id,
        nickname: user.nickname,
        username: user.username,
        email: user.email,
        deptName: user.dept_name,
      })),
      depts: deptsResult.rows.map((dept) => ({
        id: dept.id,
        name: dept.name,
        code: dept.code,
        level: dept.level,
        path: dept.path,
      })),
      tenants: tenantsResult.rows.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        code: tenant.code,
        status: tenant.status,
      })),
      stats: {
        totalSessions: parseInt(statsResult.rows[0].total_sessions) || 0,
        totalUsers: parseInt(statsResult.rows[0].total_users) || 0,
        avgDuration: statsResult.rows[0].avg_duration
          ? Math.round(statsResult.rows[0].avg_duration)
          : 0,
        totalGoodVotes: parseInt(statsResult.rows[0].total_good_votes) || 0,
        totalBadVotes: parseInt(statsResult.rows[0].total_bad_votes) || 0,
        totalUnansweredQuestions: parseInt(statsResult.rows[0].total_unanswered_questions) || 0,
      },
    };

    res.status(200).json(filters);
  } catch (error) {
    console.error("Error fetching filters:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
