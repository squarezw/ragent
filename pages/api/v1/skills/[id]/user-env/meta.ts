import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

/**
 * GET /api/v1/skills/{id}/user-env/meta —— 键名元信息，**响应永不含值**。
 *
 * `user_id` 透传是为了让超管排查"用户是不是漏配了某个键"（后端对非属主
 * 只回键名，且非超管直接 403）。前端界面不提供查他人的入口。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/skills/${encodeURIComponent(id)}/user-env/meta`,
    allow: ["GET"],
    passQuery: ["user_id"],
  });
}
