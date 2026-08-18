import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// POST /api/v1/skills/import/validate → 整棵文件树 + 逐文件状态，不写库。
// 静态段文件名压过同目录的 [id]（与 requires-options.ts 同理）。
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/skills/import/validate",
    allow: ["POST"],
    largeBody: true,
  });
}

// 资产合计上限 100MB → base64 约 134MB；留出 JSON 包裹余量。
// 不配这一项的话 Next 默认 1mb 会先一步 413 —— 而后端的报错永远看不到。
export const config = {
  api: { bodyParser: { sizeLimit: "160mb" } },
};
