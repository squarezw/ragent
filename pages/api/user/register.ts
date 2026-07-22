import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";

const REGISTRATION_INVITE_CODE = process.env.REGISTRATION_INVITE_CODE || "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED", errorCode: "METHOD_NOT_ALLOWED" });
  }

  try {
    const { username, password, email, inviteCode } = req.body;

    // 验证必填字段
    if (!username || !password || !email || !inviteCode) {
      return res.status(400).json({ error: "MISSING_FIELDS", errorCode: "MISSING_FIELDS" });
    }

    // 验证邀请码
    if (!REGISTRATION_INVITE_CODE) {
      return res
        .status(500)
        .json({ error: "REGISTRATION_NOT_CONFIGURED", errorCode: "REGISTRATION_NOT_CONFIGURED" });
    }

    if (inviteCode !== REGISTRATION_INVITE_CODE) {
      return res
        .status(403)
        .json({ error: "INVALID_INVITE_CODE", errorCode: "INVALID_INVITE_CODE" });
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ error: "INVALID_EMAIL_FORMAT", errorCode: "INVALID_EMAIL_FORMAT" });
    }

    // 验证密码长度
    if (password.length < 6) {
      return res.status(400).json({ error: "PASSWORD_TOO_SHORT", errorCode: "PASSWORD_TOO_SHORT" });
    }

    const client = await pool.connect();
    try {
      // 检查用户名和邮箱唯一性
      const exists = await client.query("SELECT 1 FROM users WHERE username=$1 OR email=$2", [
        username,
        email,
      ]);
      if (exists.rowCount && exists.rowCount > 0) {
        return res
          .status(409)
          .json({ error: "USERNAME_OR_EMAIL_EXISTS", errorCode: "USERNAME_OR_EMAIL_EXISTS" });
      }

      const hashed = await bcrypt.hash(password, 10);

      // 开始事务
      await client.query("BEGIN");

      try {
        // 创建用户（默认角色为普通用户，不指定租户和部门）
        const result = await client.query(
          `INSERT INTO users (username, nickname, password, email, tenant_id, dept_id, status, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, NULL, NULL, 'active', NOW(), NOW()) 
           RETURNING id, username, nickname, email, tenant_id, dept_id, status`,
          [username, username, hashed, email] // nickname 默认使用 username
        );

        const newUserId = result.rows[0].id;

        // 分配默认角色：普通用户（role_id = 4）
        await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [
          newUserId,
          4, // 普通用户
        ]);

        // 提交事务
        await client.query("COMMIT");

        // 返回用户信息（不包含密码）
        const userInfo = result.rows[0];

        res.status(201).json({
          user: userInfo,
          message: "Registration successful",
        });
      } catch (error) {
        // 回滚事务
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("用户注册 API 错误:", err);
    res.status(500).json({ error: "DATABASE_ERROR", errorCode: "DATABASE_ERROR", details: err });
  }
}
