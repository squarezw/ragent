import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// GET /api/v1/skills/{id}/asset-content?path=...&stage=... → 资产原始字节（预览用）
// binary 透传：资产可能是 docx/pdf/图片，按文本读会损坏
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/skills/${encodeURIComponent(id)}/asset-content`,
    allow: ["GET"],
    passQuery: ["path", "stage"],
    binary: true,
  });
}
