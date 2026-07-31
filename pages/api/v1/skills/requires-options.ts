import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/skills/requires-options → {tools[], workflows[]}；requires 受控多选的数据源。
// 静态段文件名压过同目录的 [id]，与后端把该路由声明在 /skills/{skill_id} 之前同理。
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/skills/requires-options",
    allow: ["GET"],
  });
}
