import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  const id = req.query.id;
  if (typeof id !== "string" || !/^[1-9]\d*$/.test(id))
    return res.status(400).json({ detail: "Invalid skill identifier" });
  return proxySkillsApi(req, res, {
    path: `/api/v1/skills/${id}/package-replacement`,
    allow: ["POST"],
    multipartBody: true,
  });
}
export const config = { api: { bodyParser: false } };
