import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  const datasetId = queryStr(req.query.datasetId);
  return proxySkillsApi(req, res, {
    path: `/api/v1/apps/${encodeURIComponent(id)}/datasets/${encodeURIComponent(datasetId)}`,
    allow: ["DELETE"],
  });
}
