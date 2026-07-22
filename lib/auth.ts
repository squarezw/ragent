import jwt from "jsonwebtoken";
import type { NextApiRequest, NextApiResponse } from "next";

const JWT_SECRET = process.env.JWT_SECRET;
const AUTH_COOKIE = "ragent_token";

export function getTokenFromRequest(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  // 浏览器顶层导航(如企业微信里点参考文件链接)不会带 Authorization 头，只会带 cookie
  return req.cookies?.[AUTH_COOKIE] || null;
}

export function getUserIdFromRequest(req: NextApiRequest): number | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    return payload.userId;
  } catch {
    return null;
  }
}

// 把 JWT 同步进 httpOnly cookie，让浏览器顶层导航也能携带鉴权
export function setAuthCookie(res: NextApiResponse, token: string) {
  const maxAge = 60 * 60 * 24 * 7; // ponytail: 7d，与 JWT_EXPIRES_IN 默认值对齐；不一致时 cookie 里的 JWT 先失效并触发重新登录，安全
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
  );
}

// 可选：统一处理未登录响应
export function requireAuth(req: NextApiRequest, res: NextApiResponse): boolean {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    res.status(401).json({ error: "未登录" });
    return false;
  }
  return true;
}
