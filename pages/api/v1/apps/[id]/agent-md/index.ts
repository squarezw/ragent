import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// GET /api/v1/apps/{appId}/agent-md → {content, frontmatter, is_legacy}（?export=true 合成版）
// PUT {content}（校验失败 422，detail 含行号）· DELETE 置 NULL 回落 legacy
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const appId = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/apps/${encodeURIComponent(appId)}/agent-md`,
    allow: ["GET", "PUT", "DELETE"],
    passQuery: ["export"],
  });
}
