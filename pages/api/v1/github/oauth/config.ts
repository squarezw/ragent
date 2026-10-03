import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET / PUT /api/v1/github/oauth/config —— 当前用户自己的 GitHub OAuth 应用
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/github/oauth/config",
    allow: ["GET", "PUT"],
  });
}
