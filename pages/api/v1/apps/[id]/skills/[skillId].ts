import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// PUT /api/v1/apps/{appId}/skills/{skillId}（改 priority）· DELETE 解绑
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const appId = queryStr(req.query.id);
  const skillId = queryStr(req.query.skillId);
  return proxySkillsApi(req, res, {
    path: `/api/v1/apps/${encodeURIComponent(appId)}/skills/${encodeURIComponent(skillId)}`,
    allow: ["PUT", "DELETE"],
  });
}
