import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/sandbox-images → {items[], total}；exec 配置的镜像下拉框取值
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/sandbox-images",
    allow: ["GET"],
    passQuery: ["include_disabled"],
  });
}
