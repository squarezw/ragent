import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// GET /api/v1/apps/{appId}/skills（绑定列表含 skill 摘要）· POST 绑定 {skill_id}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const appId = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/apps/${encodeURIComponent(appId)}/skills`,
    allow: ["GET", "POST"],
  });
}
