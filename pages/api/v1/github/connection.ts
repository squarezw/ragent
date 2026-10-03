import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET / DELETE /api/v1/github/connection —— 当前用户的 GitHub 连接状态
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/github/connection",
    allow: ["GET", "DELETE"],
  });
}
