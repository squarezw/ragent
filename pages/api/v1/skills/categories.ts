import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/skills/categories → {categories[], fallback}，来自后端打包的
// config/skill_categories.yaml。静态段文件名压过同目录的 [id]。
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/skills/categories",
    allow: ["GET"],
  });
}
