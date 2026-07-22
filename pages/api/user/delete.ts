import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  canManageTenant,
  canManageDept,
  isSuperAdmin,
  getUserPermissions,
} from "@/lib/permissions";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "DELETE") {
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

    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Missing user id" });
    }

    // 不能删除自己
    if (id === userId) {
      return res.status(400).json({ error: "不能删除自己的账户" });
    }

    const client = await pool.connect();
    try {
      // 检查目标用户是否存在
      const targetUserRes = await client.query(
        "SELECT tenant_id, dept_id FROM users WHERE id = $1",
        [id]
      );
      if (!targetUserRes.rowCount || targetUserRes.rowCount === 0) {
        return res.status(404).json({ error: "用户不存在" });
      }

      const targetUser = targetUserRes.rows[0];

      // 检查权限 - 只有超级管理员可以删除用户
      const isSuper = await isSuperAdmin(userId);
      if (!isSuper) {
        return res.status(403).json({ error: "只有超级管理员可以删除用户" });
      }

      const result = await client.query("DELETE FROM users WHERE id=$1 RETURNING id", [id]);
      if (!result.rowCount || result.rowCount === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      res.status(200).json({ success: true, id });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("删除用户 API 错误:", err);
    res.status(500).json({ error: "Database error", details: err });
  }
}
