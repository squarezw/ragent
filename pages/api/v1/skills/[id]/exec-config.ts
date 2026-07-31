import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// GET (404 = 非可执行 skill) / PUT /api/v1/skills/{id}/exec-config
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/skills/${encodeURIComponent(id)}/exec-config`,
    allow: ["GET", "PUT"],
    passQuery: ["stage"],
  });
}
