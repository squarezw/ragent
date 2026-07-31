import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// POST /api/v1/apps/{id}/review {approve: bool, comment?: string}（与 skills 同构）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/apps/${encodeURIComponent(id)}/review`,
    allow: ["POST"],
  });
}
