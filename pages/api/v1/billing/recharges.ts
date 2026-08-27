import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/billing/recharges → 充值记录（谁、给谁、多少、何时、备注）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/billing/recharges",
    allow: ["GET"],
    passQuery: ["tenant_id", "page", "page_size"],
  });
}
