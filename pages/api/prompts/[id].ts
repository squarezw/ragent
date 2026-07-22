import { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { method } = req;
  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid prompt ID" });
  }

  try {
    switch (method) {
      case "PUT":
        return await updatePrompt(req, res, userId, parseInt(id));
      case "DELETE":
        return await deletePrompt(req, res, userId, parseInt(id));
      default:
        res.setHeader("Allow", ["PUT", "DELETE"]);
        return res.status(405).json({ error: `Method ${method} Not Allowed` });
    }
  } catch (error) {
    console.error("Prompt API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

async function updatePrompt(
  req: NextApiRequest,
  res: NextApiResponse,
  userId: number,
  promptId: number
) {
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

    // 检查提示词是否存在
    const promptRes = await client.query("SELECT * FROM prompts WHERE id = $1", [promptId]);

    if (promptRes.rows.length === 0) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    const prompt = promptRes.rows[0];

    // 超级管理员或创建者可以编辑提示词
    const isSuperAdmin = await import("@/lib/permissions").then((m) => m.isSuperAdmin(userId));
    if (!isSuperAdmin && prompt.user_id !== userId) {
      return res.status(403).json({ error: "只有超级管理员或创建者才能修改提示词" });
    }
    // 检查角色名称是否重复（排除当前提示词）
    const existingRes = await client.query(
      "SELECT id FROM prompts WHERE role = $1 AND user_id = $2 AND id != $3",
      [role, prompt.user_id, promptId]
    );

    if (existingRes.rows.length > 0) {
      return res.status(400).json({ error: "角色名称已存在" });
    }

    // 如果设置为默认提示词，先取消其他默认提示词
    if (is_default) {
      await client.query("UPDATE prompts SET is_default = false WHERE user_id = $1 AND id != $2", [
        prompt.user_id,
        promptId,
      ]);
    }

    // 移除对默认提示词停用的限制，允许停用所有默认提示词
    // 当所有默认提示词都被停用时，系统会使用内置的默认提示词

    const finalIsActive = is_active !== false;

    // 更新提示词
    const updateRes = await client.query(
      `UPDATE prompts 
       SET role = $1, content = $2, visibility = $3, is_default = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [role, content, visibility || "dept", is_default || false, finalIsActive, promptId]
    );

    return res.status(200).json(updateRes.rows[0]);
  } finally {
    client.release();
  }
}

async function deletePrompt(
  req: NextApiRequest,
  res: NextApiResponse,
  userId: number,
  promptId: number
) {
  // 检查用户是否是超级管理员
  const isSuperAdmin = await import("@/lib/permissions").then((m) => m.isSuperAdmin(userId));

  if (!isSuperAdmin) {
    return res.status(403).json({ error: "只有超级管理员才能删除提示词" });
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

    // 检查提示词是否存在
    const promptRes = await client.query("SELECT * FROM prompts WHERE id = $1", [promptId]);

    if (promptRes.rows.length === 0) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    const prompt = promptRes.rows[0];

    // 只有停用的提示词才能删除
    if (prompt.is_active) {
      return res.status(400).json({ error: "只能删除已停用的提示词，请先停用该提示词" });
    }

    // 硬删除提示词（真正的删除）
    const deleteRes = await client.query("DELETE FROM prompts WHERE id = $1 RETURNING *", [
      promptId,
    ]);

    if (deleteRes.rows.length === 0) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    return res.status(200).json({ message: "Prompt deleted successfully" });
  } finally {
    client.release();
  }
}
