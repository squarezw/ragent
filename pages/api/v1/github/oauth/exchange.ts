import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// POST /api/v1/github/oauth/exchange { code, state }
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/github/oauth/exchange",
    allow: ["POST"],
  });
}
