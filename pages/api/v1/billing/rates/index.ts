import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET  /api/v1/billing/rates → 显式系数 + 全局默认 + 在吃默认值的实体清单
// PUT  /api/v1/billing/rates → 设置系数（后端与审计同事务）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/billing/rates",
    allow: ["GET", "PUT"],
  });
}
