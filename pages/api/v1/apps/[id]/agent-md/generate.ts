import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// POST /api/v1/apps/{appId}/agent-md/generate（从 prompt_id 生成纯正文，不带 frontmatter；已有时 409，?overwrite=true）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const appId = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/apps/${encodeURIComponent(appId)}/agent-md/generate`,
    allow: ["POST"],
    passQuery: ["overwrite"],
  });
}
