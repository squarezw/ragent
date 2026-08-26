import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/billing/rates/audit → 系数变更记录
// 「上个月为什么扣得少」靠它回答，所以这条不能省
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/billing/rates/audit",
    allow: ["GET"],
    passQuery: ["limit"],
  });
}
