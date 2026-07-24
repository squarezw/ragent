import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/prompt-variables（Skill / Agent.md 编辑器可用变量清单）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/prompt-variables",
    allow: ["GET"],
  });
}
