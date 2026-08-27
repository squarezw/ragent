import { NextApiRequest, NextApiResponse } from "next";
import pool from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth";
import { buildVisibilityScope, deptIdsAtOrBelow } from "@/lib/visibilityScope";

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
    // 可见范围：全站唯一的一份阶梯在 lib/visibilityScope.ts。
    // 这个接口喂的是筛选器下拉框和统计数字，三套条件（用户 / 部门 / 统计）
    // 原先各写各的，结果**部门那套在普通用户档下压根没条件** ——
    // 任何登录用户都能拉到全部租户的组织架构。
    const scopeUsers = await buildVisibilityScope(
      currentUserId,
      { userIdCol: "u.id", userAlias: "u" },
      1
    );
    const scopeStats = await buildVisibilityScope(
      currentUserId,
      { userIdCol: "cs.user_id", userAlias: "u" },
      1
    );
    if (!scopeUsers || !scopeStats) {
      return res.status(404).json({ error: "用户不存在" });
    }
    const { tier, perms: userPerms } = scopeUsers;
    const superAdmin = tier === "super";

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
    } else {
      // 用户列表与统计：两套列名不同，但走同一张梯子
      userWhereConditions.push(...scopeUsers.conditions);
      userQueryParams.push(...scopeUsers.params);
      userParamIndex = scopeUsers.nextIndex;

      statsWhereConditions.push(...scopeStats.conditions);
      statsQueryParams.push(...scopeStats.params);
      statsParamIndex = scopeStats.nextIndex;

      // 部门下拉框：查的是 dept 表本身，没有「归属人」可挂，所以不能复用
      // buildVisibilityScope，只能按档位各写一句。**每一档都必须有条件** ——
      // 原先普通用户这一档什么都没加，于是 deptWhereClause 只剩 status='active'，
      // 把全库所有租户的部门树（含 path）返给了任何登录用户。
      if (tier === "tenant") {
        deptWhereConditions.push(`tenant_id = $${deptParamIndex}`);
        deptQueryParams.push(userPerms.tenantId);
        deptParamIndex++;
      } else if (tier === "dept") {
        deptWhereConditions.push(`id = ANY($${deptParamIndex}::int[])`);
        deptQueryParams.push(await deptIdsAtOrBelow(userPerms.deptId));
        deptParamIndex++;
      } else {
        // 普通用户只认自己那个部门；没归属部门就是空列表（他本来也不能按部门筛）
        deptWhereConditions.push(`id = $${deptParamIndex}`);
        deptQueryParams.push(userPerms.deptId);
        deptParamIndex++;
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
