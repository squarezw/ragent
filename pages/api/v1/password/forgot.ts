import pool from "@/lib/db";
import axios from "axios";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import type { NextApiRequest, NextApiResponse } from "next";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";
const JWT_SECRET = process.env.JWT_SECRET;

// 邮箱验证正则
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 频率限制：5分钟
const RATE_LIMIT_MINUTES = 5;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username, baseUrl } = req.body;

  // 验证用户名
  if (!username || typeof username !== "string" || username.trim().length === 0) {
    return res.status(400).json({ error: "请输入用户名" });
  }

  // 验证 baseUrl
  if (!baseUrl || typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    return res.status(400).json({ error: "缺少 baseUrl 参数" });
  }

  console.log("baseUrl", baseUrl);

  try {
    // 根据用户名查找用户及其邮箱
    const userResult = await pool.query(
      "SELECT id, username, nickname, email FROM users WHERE username = $1",
      [username.trim()]
    );

    // 用户不存在
    if (userResult.rowCount === 0) {
      return res.status(400).json({
        error: "用户名不存在",
      });
    }

    const user = userResult.rows[0];
    const email = user.email;

    // 用户没有绑定邮箱
    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: "该用户未绑定有效邮箱，请联系管理员",
      });
    }

    // 检查频率限制：是否在5分钟内已经请求过
    const recentTokenResult = await pool.query(
      `SELECT id, created_at FROM password_reset_tokens
       WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '${RATE_LIMIT_MINUTES} minutes'
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id]
    );

    if (recentTokenResult.rowCount > 0) {
      const tokenCreatedAt = new Date(recentTokenResult.rows[0].created_at);
      const retryAfter = new Date(tokenCreatedAt.getTime() + RATE_LIMIT_MINUTES * 60 * 1000);
      return res.status(429).json({
        error: `请求过于频繁，请${RATE_LIMIT_MINUTES}分钟后再试`,
        retryAfter: retryAfter.toISOString(),
      });
    }

    // 生成唯一令牌
    const token = randomUUID();

    // 设置30分钟过期时间
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // 保存令牌到数据库
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt]
    );

    // 使用前端传递的 baseUrl 构建重置链接
    const resetLink = `${baseUrl.trim()}/reset-password?token=${token}`;

    // 发送邮件
    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">密码重置请求</h2>
        <p>您好 ${user.nickname || user.username}，</p>
        <p>我们收到了您的密码重置请求。请点击下面的链接重置您的密码：</p>
        <p style="margin: 30px 0;">
          <a href="${resetLink}"
             style="background-color: #007bff; color: white; padding: 12px 24px;
                    text-decoration: none; border-radius: 4px; display: inline-block;">
            重置密码
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">
          此链接将在 <strong>30分钟</strong> 后失效。
        </p>
        <p style="color: #666; font-size: 14px;">
          如果您没有请求重置密码，请忽略此邮件。
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          如果按钮无法点击，请复制以下链接到浏览器：<br>
          ${resetLink}
        </p>
      </div>
    `;

    try {
      // 生成系统服务 token（使用发起请求的用户ID，短期有效）
      const serviceToken = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: "5m",
      });

      // 调用 Python 后端邮件发送接口
      await axios.post(
        `${EXTERNAL_API_BASE_URL}/api/v1/email/send`,
        {
          title: "找回密码",
          body: emailBody,
          to: email,
          is_html: true,
        },
        {
          headers: {
            Authorization: `Bearer ${serviceToken}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );
    } catch (emailError) {
      console.error("邮件发送失败:", emailError);
      // 即使邮件发送失败，也返回成功消息（安全考虑）
      // 但在日志中记录错误以便排查
    }

    return res.status(200).json({
      success: true,
      message: "如果该邮箱已注册，您将收到密码重置邮件",
    });
  } catch (err) {
    console.error("忘记密码处理错误:", err);
    return res.status(500).json({
      error: "服务器错误，请稍后重试",
      details: process.env.NODE_ENV === "development" ? err : undefined,
    });
  }
}
