import type { NextApiRequest, NextApiResponse } from "next";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token } = req.query;

  // 验证必填字段
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "缺少令牌参数" });
  }

  try {
    // 查询令牌信息
    const tokenResult = await pool.query(
      `SELECT id, expires_at, used
       FROM password_reset_tokens
       WHERE token = $1`,
      [token]
    );

    // 令牌不存在
    if (tokenResult.rowCount === 0) {
      return res.status(200).json({
        valid: false,
        reason: "not_found",
        message: "无效的重置链接",
      });
    }

    const tokenData = tokenResult.rows[0];

    // 令牌已使用
    if (tokenData.used) {
      return res.status(200).json({
        valid: false,
        reason: "already_used",
        message: "此重置链接已使用",
      });
    }

    // 令牌已过期
    if (new Date(tokenData.expires_at) < new Date()) {
      return res.status(200).json({
        valid: false,
        reason: "expired",
        message: "重置链接已过期",
      });
    }

    // 令牌有效
    return res.status(200).json({
      valid: true,
      message: "令牌有效",
    });
  } catch (err) {
    console.error("令牌验证错误:", err);
    return res.status(500).json({
      error: "服务器错误，请稍后重试",
      details: process.env.NODE_ENV === "development" ? err : undefined,
    });
  }
}
