import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  return proxySkillsApi(req, res, {
    path: "/api/v1/remote-sandbox-environments",
    allow: ["GET"],
  });
}
