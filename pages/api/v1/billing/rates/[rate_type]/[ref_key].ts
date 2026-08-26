import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// DELETE /api/v1/billing/rates/{type}/{key} → 删除显式系数，回落全局默认
//
// 注意语义：删除 ≠ 不计费，而是回落到该类型的全局默认值。
// 后端拒绝删除 ref_key='*' 的兜底行 —— 删了该类型就没有兜底，
// 未登记条目会静默按 0 计。
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { rate_type, ref_key } = req.query;
  return proxySkillsApi(req, res, {
    path: `/api/v1/billing/rates/${encodeURIComponent(String(rate_type))}/${encodeURIComponent(String(ref_key))}`,
    allow: ["DELETE"],
  });
}
