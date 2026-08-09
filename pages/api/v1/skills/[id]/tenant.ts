import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// PUT /api/v1/skills/{id}/tenant —— 迁移到另一个租户（仅超管，后端强制；不走审核）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/skills/${encodeURIComponent(id)}/tenant`,
    allow: ["PUT"],
  });
}
