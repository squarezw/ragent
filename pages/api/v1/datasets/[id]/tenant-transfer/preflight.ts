import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  const id = req.query.id;
  if (typeof id !== "string" || !/^[a-fA-F0-9-]+$/.test(id))
    return res.status(400).json({ detail: "Invalid identifier" });
  return proxySkillsApi(req, res, {
    path: `/api/v1/datasets/${id}/tenant-transfer/preflight`,
    allow: ["POST"],
  });
}
