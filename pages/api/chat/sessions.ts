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

    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      userId,
      deptId,
      tenantId,
      search,
      feedback,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    // 构建查询条件
    const whereConditions = [];
    const queryParams = [];
    let paramIndex = 1;

    // 权限过滤：根据角色添加相应的限制条件
    if (!superAdmin) {
      if (tenantAdmin && userPerms.tenantId) {
        // 租户管理员：只能看到本租户下的会话
        whereConditions.push(`u.tenant_id = $${paramIndex}`);
        queryParams.push(userPerms.tenantId);
        paramIndex++;
      } else if (deptAdmin && userPerms.deptId) {
        // 部门管理员：只能看到本部门下的会话
        whereConditions.push(`u.dept_id = $${paramIndex}`);
        queryParams.push(userPerms.deptId);
        paramIndex++;
      } else {
        // 普通用户：只能看到自己的会话
        whereConditions.push(`cs.user_id = $${paramIndex}`);
        queryParams.push(currentUserId);
        paramIndex++;
      }
    }
    // 超级管理员：不添加任何限制，可以看到所有会话

    // 时间范围筛选
    if (startDate) {
      whereConditions.push(`cs.created_at >= $${paramIndex}`);
      queryParams.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      whereConditions.push(`cs.created_at <= $${paramIndex}`);
      queryParams.push(endDate);
      paramIndex++;
    }

    // 用户筛选（需要权限检查）
    if (userId) {
      const targetUserId = Number(userId);
      // 超级管理员可以查看任何用户
      // 租户管理员只能查看本租户的用户
      // 部门管理员只能查看本部门的用户
      if (!superAdmin) {
        if (tenantAdmin && userPerms.tenantId) {
          // 验证目标用户是否在同一租户
          const targetUserRes = await pool.query("SELECT tenant_id FROM users WHERE id = $1", [
            targetUserId,
          ]);
          if (
            targetUserRes.rows.length === 0 ||
            targetUserRes.rows[0].tenant_id !== userPerms.tenantId
          ) {
            return res.status(403).json({ error: "无权查看该用户的会话" });
          }
        } else if (deptAdmin && userPerms.deptId) {
          // 验证目标用户是否在同一部门
          const targetUserRes = await pool.query("SELECT dept_id FROM users WHERE id = $1", [
            targetUserId,
          ]);
          if (
            targetUserRes.rows.length === 0 ||
            targetUserRes.rows[0].dept_id !== userPerms.deptId
          ) {
            return res.status(403).json({ error: "无权查看该用户的会话" });
          }
        } else {
          // 普通用户只能查看自己的会话
          if (targetUserId !== currentUserId) {
            return res.status(403).json({ error: "无权查看该用户的会话" });
          }
        }
      }
      whereConditions.push(`cs.user_id = $${paramIndex}`);
      queryParams.push(targetUserId);
      paramIndex++;
    }

    // 部门筛选（需要权限检查）
    if (deptId) {
      const targetDeptId = Number(deptId);
      if (!superAdmin) {
        if (tenantAdmin && userPerms.tenantId) {
          // 租户管理员只能查看本租户下的部门
          const deptRes = await pool.query("SELECT tenant_id FROM dept WHERE id = $1", [
            targetDeptId,
          ]);
          if (deptRes.rows.length === 0 || deptRes.rows[0].tenant_id !== userPerms.tenantId) {
            return res.status(403).json({ error: "无权查看该部门的会话" });
          }
        } else if (deptAdmin && userPerms.deptId) {
          // 部门管理员只能查看自己的部门
          if (targetDeptId !== userPerms.deptId) {
            return res.status(403).json({ error: "无权查看该部门的会话" });
          }
        } else {
          // 普通用户不能按部门筛选
          return res.status(403).json({ error: "无权按部门筛选会话" });
        }
      }
      whereConditions.push(`u.dept_id = $${paramIndex}`);
      queryParams.push(targetDeptId);
      paramIndex++;
    }

    // 租户筛选（只有超级管理员可以按租户筛选）
    if (tenantId) {
      const targetTenantId = Number(tenantId);
      if (!superAdmin) {
        return res.status(403).json({ error: "无权按租户筛选会话" });
      }
      whereConditions.push(`u.tenant_id = $${paramIndex}`);
      queryParams.push(targetTenantId);
      paramIndex++;
    }

    // 搜索条件
    if (search) {
      whereConditions.push(
        `(cs.summary ILIKE $${paramIndex} OR u.nickname ILIKE $${paramIndex} OR u.username ILIKE $${paramIndex})`
      );
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // 反馈筛选条件
    if (feedback) {
      if (feedback === "good") {
        whereConditions.push(
          `EXISTS (SELECT 1 FROM chat_session_detail csd WHERE csd.session_id = cs.id AND csd.vote_good = true)`
        );
      } else if (feedback === "bad") {
        whereConditions.push(
          `EXISTS (SELECT 1 FROM chat_session_detail csd WHERE csd.session_id = cs.id AND csd.vote_bad = true)`
        );
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // 获取总数
    const countQuery = `
      SELECT COUNT(DISTINCT cs.id) as total
      FROM chat_session cs
      LEFT JOIN users u ON cs.user_id = u.id
      LEFT JOIN dept d ON u.dept_id = d.id
      ${whereClause}
    `;

    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // 获取会话列表
    const sessionsQuery = `
      SELECT 
        cs.id,
        cs.created_at,
        cs.updated_at,
        cs.user_id,
        cs.summary,
        cs.dataset_ids,
        cs.app_id,
        u.nickname as user_nickname,
        u.username as user_username,
        u.email as user_email,
        d.name as dept_name,
        d.code as dept_code,
        a.name as app_name,
        COUNT(csd.id) as detail_count,
        AVG(csd.duration_ms) as avg_duration,
        SUM(CASE WHEN csd.vote_good = true THEN 1 ELSE 0 END) as good_votes,
        SUM(CASE WHEN csd.vote_bad = true THEN 1 ELSE 0 END) as bad_votes
      FROM chat_session cs
      LEFT JOIN users u ON cs.user_id = u.id
      LEFT JOIN dept d ON u.dept_id = d.id
      LEFT JOIN apps a ON cs.app_id = a.id
      LEFT JOIN chat_session_detail csd ON cs.id = csd.session_id
      ${whereClause}
      GROUP BY cs.id, cs.created_at, cs.updated_at, cs.user_id, cs.summary, cs.dataset_ids, cs.app_id, u.nickname, u.username, u.email, d.name, d.code, a.name
      ORDER BY cs.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(Number(limit), offset);
    const sessionsResult = await pool.query(sessionsQuery, queryParams);

    // 格式化结果
    const sessions = sessionsResult.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      userId: row.user_id,
      summary: row.summary,
      datasetIds: row.dataset_ids || [],
      appId: row.app_id,
      app: {
        id: row.app_id,
        name: row.app_name,
      },
      user: {
        nickname: row.user_nickname,
        username: row.user_username,
        email: row.user_email,
      },
      dept: {
        name: row.dept_name,
        code: row.dept_code,
      },
      stats: {
        detailCount: parseInt(row.detail_count) || 0,
        avgDuration: row.avg_duration ? Math.round(row.avg_duration) : 0,
        goodVotes: parseInt(row.good_votes) || 0,
        badVotes: parseInt(row.bad_votes) || 0,
      },
    }));

    res.status(200).json({
      sessions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
