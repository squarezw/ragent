import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// GET /api/v1/apps/{appId}/skills/diagnostics → 每个已发布 skill 是否真会被注入 + 缺口清单
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const appId = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/apps/${encodeURIComponent(appId)}/skills/diagnostics`,
    allow: ["GET"],
  });
}
