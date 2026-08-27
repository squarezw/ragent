import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/billing/accounts → 租户积分账户（余额 / 累计充值 / 累计消耗）
// 余额由后端从流水现算，不存余额列（迁移 064）。
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/billing/accounts",
    allow: ["GET"],
    passQuery: ["tenant_id"],
  });
}
