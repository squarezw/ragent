import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

/**
 * GET / PUT /api/v1/skills/{id}/user-env —— 调用者**自己**那份个人环境变量。
 *
 * 纯透传：请求体含凭据值，这里既不落日志也不改形状（proxySkillsApi 只在后端
 * 不可达时打 method + url，不打 body）。后端按 JWT 认定属主，前端无从指定他人。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/skills/${encodeURIComponent(id)}/user-env`,
    allow: ["GET", "PUT"],
  });
}
