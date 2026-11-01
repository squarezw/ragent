import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  const { id, transferId } = req.query;
  if (
    typeof id !== "string" ||
    !/^[1-9]\d*$/.test(id) ||
    typeof transferId !== "string" ||
    !/^[a-zA-Z0-9-]+$/.test(transferId)
  )
    return res.status(400).json({ detail: "Invalid identifier" });
  return proxySkillsApi(req, res, {
    path: `/api/v1/apps/${id}/tenant-transfer/${transferId}/rollback`,
    allow: ["POST"],
  });
}
