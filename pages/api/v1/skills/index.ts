import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/skills（?q= 搜索）· POST /api/v1/skills
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/skills",
    allow: ["GET", "POST"],
    passQuery: ["q"],
  });
}
