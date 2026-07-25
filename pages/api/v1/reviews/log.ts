import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/reviews/log?target_type=skill|app&target_id=<int>
// → {items: [{id, action, comment, actor_id, actor_name, created_at}]} 倒序 ≤50 条
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/reviews/log",
    allow: ["GET"],
    passQuery: ["target_type", "target_id"],
  });
}
