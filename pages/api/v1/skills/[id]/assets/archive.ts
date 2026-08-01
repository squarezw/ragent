import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// GET /api/v1/skills/{id}/assets/archive?stage=draft|published → zip（二进制透传）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/skills/${encodeURIComponent(id)}/assets/archive`,
    allow: ["GET"],
    passQuery: ["stage"],
    binary: true,
  });
}
