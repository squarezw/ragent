import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

/** GET /api/v1/llm-models → 后端对话模型目录（应用配置下拉） */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/llm-models/",
    allow: ["GET"],
  });
}
