import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// POST /api/v1/billing/recharge → 给租户充值积分（仅超管）
//
// 纯透传。**充值逻辑一律不放在 Node 这一侧**（用户裁定 2026-08-27）：
// 金额、幂等、权限、留档全部由 Python 后端在一个事务里决定。这里多写一行判断，
// 就等于多了一处可以和后端不一致的地方，而不一致的那一处会是钱。
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/billing/recharge",
    allow: ["POST"],
  });
}
