import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "@/lib/db";
import { setAuthCookie } from "@/lib/auth";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password" });
  }
  try {
    const result = await pool.query(
      "SELECT id, username, nickname, password, email FROM users WHERE username=$1",
      [username]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: "用户名或密码错误" });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "用户名或密码错误" });
    }
    // 生成 JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    setAuthCookie(res, token); // 让浏览器直开下载链接时也能带上鉴权
    // 不返回密码 与 id
    const { password: _, id: __, ...userInfo } = user;
    res.status(200).json({ user: userInfo, token });
  } catch (err) {
    res.status(500).json({ error: "Database error", details: err });
  }
}
