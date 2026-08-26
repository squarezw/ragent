import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/billing/usage/summary → 按租户/用户/会话聚合的积分消耗
//
// passQuery 是**白名单**：没列进来的参数会被静默丢掉。少一个的表现是
// 「筛选点了没反应」——不报错，所以加筛选条件时务必同步这里。
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/billing/usage/summary",
    allow: ["GET"],
    passQuery: ["group_by", "tenant_id", "user_id", "start", "end"],
  });
}
