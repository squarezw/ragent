import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";

// 密码强度验证：至少8位，包含字母和数字
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token, newPassword } = req.body;

  // 验证必填字段
  if (!token || !newPassword) {
    return res.status(400).json({ error: "缺少必要参数" });
  }

  // 验证密码强度
  if (!PASSWORD_REGEX.test(newPassword)) {
    return res.status(400).json({
      error: "密码必须至少8位，且包含字母和数字",
    });
  }

  try {
    // 查询令牌信息
    const tokenResult = await pool.query(
      `SELECT id, user_id, expires_at, used
       FROM password_reset_tokens
       WHERE token = $1`,
      [token]
    );

    // 令牌不存在
    if (tokenResult.rowCount === 0) {
      return res.status(400).json({ error: "无效的重置链接" });
    }

    const tokenData = tokenResult.rows[0];

    // 令牌已使用
    if (tokenData.used) {
      return res.status(400).json({ error: "此重置链接已使用，请重新申请" });
    }

    // 令牌已过期
    if (new Date(tokenData.expires_at) < new Date()) {
      return res.status(400).json({ error: "重置链接已过期，请重新申请" });
    }

    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 开始事务：更新密码、标记令牌已使用、删除其他未使用的令牌
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 更新用户密码
      await client.query("UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2", [
        hashedPassword,
        tokenData.user_id,
      ]);

      // 标记当前令牌为已使用
      await client.query("UPDATE password_reset_tokens SET used = TRUE WHERE id = $1", [
        tokenData.id,
      ]);

      // 删除该用户所有其他未使用的令牌
      await client.query(
        "DELETE FROM password_reset_tokens WHERE user_id = $1 AND id != $2 AND used = FALSE",
        [tokenData.user_id, tokenData.id]
      );

      await client.query("COMMIT");

      return res.status(200).json({
        success: true,
        message: "密码重置成功，请使用新密码登录",
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("密码重置错误:", err);
    return res.status(500).json({
      error: "服务器错误，请稍后重试",
      details: process.env.NODE_ENV === "development" ? err : undefined,
    });
  }
}
