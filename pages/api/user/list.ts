import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";
import { buildVisibilityScope } from "@/lib/visibilityScope";
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

    // 获取筛选参数
    const filterTenantId = req.query.tenant_id ? parseInt(req.query.tenant_id as string, 10) : null;
    const filterDeptId = req.query.dept_id ? parseInt(req.query.dept_id as string, 10) : null;
    const filterUsername = req.query.username ? (req.query.username as string).trim() : null;

    const client = await pool.connect();
    try {
      let query = "";

      // 可见范围：全站唯一的一份阶梯在 lib/visibilityScope.ts。
      //
      // 这个文件曾是**唯一**写全了阶梯的地方（含「排除更高权限角色」），
      // 而 chat 会话族四个接口各自漏了它。收进共用件之后，漏掉一档不再是
      // 「某个文件少写了两行」，而是根本没有别的地方可以写。
      //
      // 换过来还带一处行为变化：部门管理员从**精确部门**改为**部门子树**，
      // 与后端 org_scope / Skill 管理对齐 —— 技术部的管理员本来就该看得到
      // 开发组的人，原先看不到。
      const scope = await buildVisibilityScope(
        userId,
        { userIdCol: "u.id", userAlias: "u" },
        1
      );
      if (!scope) {
        return res.status(404).json({ error: "用户不存在" });
      }

      const whereConditions: string[] = [...scope.conditions];
      const params: any[] = [...scope.params];
      let paramIndex = scope.nextIndex;

      // 筛选参数。超管可按租户/部门任意筛；其余人的筛选只会在可见范围内
      // 进一步收窄（上面的条件已经 AND 进同一个 WHERE），越权筛不出东西。
      if (scope.tier === "super" && filterTenantId !== null) {
        whereConditions.push(`u.tenant_id = $${paramIndex}`);
        params.push(filterTenantId);
        paramIndex++;
      }
      if (filterDeptId !== null) {
        whereConditions.push(`u.dept_id = $${paramIndex}`);
        params.push(filterDeptId);
        paramIndex++;
      }
      if (filterUsername) {
        whereConditions.push(
          `(u.username ILIKE $${paramIndex} OR u.nickname ILIKE $${paramIndex})`
        );
        params.push(`%${filterUsername}%`);
        paramIndex++;
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
