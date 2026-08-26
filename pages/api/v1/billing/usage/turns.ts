import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/billing/usage/turns → 轮次明细（含落库时的 breakdown 快照）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/billing/usage/turns",
    allow: ["GET"],
    passQuery: ["tenant_id", "user_id", "session_id", "start", "end", "page", "page_size"],
  });
}
