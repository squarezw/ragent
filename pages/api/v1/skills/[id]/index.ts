import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// GET / PUT / DELETE /api/v1/skills/{id}（DELETE 被引用返 409，?force=true 级联）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/skills/${encodeURIComponent(id)}`,
    allow: ["GET", "PUT", "DELETE"],
    passQuery: ["force"],
  });
}
