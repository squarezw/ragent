import { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { method } = req;

  try {
    switch (method) {
      case "GET":
        return await getPrompts(req, res, userId);
      case "POST":
        return await createPrompt(req, res, userId);
      default:
        res.setHeader("Allow", ["GET", "POST"]);
        return res.status(405).json({ error: `Method ${method} Not Allowed` });
    }
  } catch (error) {
    console.error("Prompt API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

async function getPrompts(req: NextApiRequest, res: NextApiResponse, userId: number) {
  // 读取提示词没有权限限制，所有用户都可以读取

  const client = await pool.connect();

  try {
    // 获取用户信息
    const userRes = await client.query("SELECT id, dept_id, tenant_id FROM users WHERE id = $1", [
      userId,
    ]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentUser = userRes.rows[0];

    // 检查是否是超级管理员
    const isSuperAdmin = await import("@/lib/permissions").then((m) => m.isSuperAdmin(userId));

    // 构建查询条件
    let query = `
      SELECT p.*, u.nickname as creator_name, d.name as creator_dept
      FROM prompts p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN dept d ON u.dept_id = d.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // 超级管理员可以看到所有提示词（包括停用的），其他用户只能看到激活的提示词
    if (!isSuperAdmin) {
      query += ` AND (p.is_active = true OR p.user_id = $${paramIndex})`;
      params.push(currentUser.id);
      paramIndex++;
    }

    // 权限过滤
    if (currentUser.tenant_id) {
      // 租户管理员可以看到租户内所有提示词
      query += ` AND (
        p.visibility = 'public' OR
        (p.visibility = 'tenant' AND p.owner_tenant_id = $${paramIndex}) OR
        (p.visibility = 'dept' AND p.owner_dept_id = $${paramIndex + 1}) OR
        (p.visibility = 'private' AND p.user_id = $${paramIndex + 2}) OR
        p.owner_tenant_id = $${paramIndex}
      )`;
      params.push(currentUser.tenant_id, currentUser.dept_id, currentUser.id);
      paramIndex += 3;
    } else if (currentUser.dept_id) {
      // 部门管理员可以看到部门内所有提示词
      query += ` AND (
        p.visibility = 'public' OR
        (p.visibility = 'dept' AND p.owner_dept_id = $${paramIndex}) OR
        (p.visibility = 'private' AND p.user_id = $${paramIndex + 1}) OR
        p.owner_dept_id = $${paramIndex}
      )`;
      params.push(currentUser.dept_id, currentUser.id);
      paramIndex += 2;
    } else {
      // 普通用户只能看到自己的提示词和公开的
      query += ` AND (
        p.visibility = 'public' OR
        p.user_id = $${paramIndex}
      )`;
      params.push(currentUser.id);
      paramIndex++;
    }

    query += ` ORDER BY p.is_default DESC, (p.user_id = $${paramIndex}) DESC, p.updated_at DESC`;
    params.push(currentUser.id);

    const result = await client.query(query, params);

    return res.status(200).json(result.rows);
  } finally {
    client.release();
  }
}

async function createPrompt(req: NextApiRequest, res: NextApiResponse, userId: number) {
  // 检查用户是否是超级管理员
  const isSuperAdmin = await import("@/lib/permissions").then((m) => m.isSuperAdmin(userId));

  if (!isSuperAdmin) {
    return res.status(403).json({ error: "只有超级管理员才能创建提示词" });
  }

  const { role, content, visibility, is_default, is_active } = req.body;

  if (!role || !content) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const client = await pool.connect();

  try {
    // 获取用户信息
    const userRes = await client.query("SELECT id, dept_id, tenant_id FROM users WHERE id = $1", [
      userId,
    ]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentUser = userRes.rows[0];

    // 检查角色名称是否重复
    const existingRes = await client.query(
      "SELECT id FROM prompts WHERE role = $1 AND user_id = $2",
      [role, currentUser.id]
    );

    if (existingRes.rows.length > 0) {
      return res.status(400).json({ error: "角色名称已存在" });
    }

    // 如果设置为默认提示词，先取消其他默认提示词
    if (is_default) {
      await client.query(
        "UPDATE prompts SET is_default = false WHERE user_id = $1 AND is_active = true",
        [currentUser.id]
      );
    }

    // 插入新提示词
    const insertRes = await client.query(
      `INSERT INTO prompts (role, content, visibility, is_default, is_active, user_id, owner_dept_id, owner_tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        role,
        content,
        visibility || "dept",
        is_default || false,
        is_active !== false,
        currentUser.id,
        currentUser.dept_id,
        currentUser.tenant_id,
      ]
    );

    return res.status(201).json(insertRes.rows[0]);
  } finally {
    client.release();
  }
}
