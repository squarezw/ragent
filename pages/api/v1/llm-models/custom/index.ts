import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  return proxySkillsApi(req, res, {
    path: "/api/v1/llm-models/custom",
    allow: ["GET", "POST"],
    passQuery: ["owner_tenant_id"],
  });
}
