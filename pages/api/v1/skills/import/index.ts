import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// POST /api/v1/skills/import → 建 draft + 灌资产（一个事务）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/skills/import",
    allow: ["POST"],
    largeBody: true,
  });
}

// 与 validate 同一上限：两条路走同一份数据，限制不一致会出现
// "校验过了、导入却 413" 这种只在大包上出现的失败。
export const config = {
  api: { bodyParser: { sizeLimit: "160mb" } },
};
