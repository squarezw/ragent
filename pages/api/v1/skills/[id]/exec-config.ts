import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

// GET (404 = 非可执行 skill) / PUT / DELETE /api/v1/skills/{id}/exec-config
//
// DELETE 取消可执行。`stage` 决定影响面，且两者差别很大：
//   draft     — 只撤草稿，线上照跑
//   published — 立刻停掉线上执行
// 后端按 stage 返回不同的 message，调用方应当原样展示给用户。
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  return proxySkillsApi(req, res, {
    path: `/api/v1/skills/${encodeURIComponent(id)}/exec-config`,
    allow: ["GET", "PUT", "DELETE"],
    passQuery: ["stage"],
  });
}
