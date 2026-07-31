import type { NextApiRequest, NextApiResponse } from "next";
import { joinEncodedSegments } from "@/lib/skillAssets";
import { proxySkillsApi, queryStr } from "@/lib/skillsProxy";

/**
 * PUT / DELETE /api/v1/skills/{id}/assets/{path}
 *
 * 后端是 `{asset_path:path}` 通配段，路径里可能带中文、空格、括号。
 * Next.js 已把 catch-all 的每一段解码好，转发前必须逐段重新编码——
 * 直接 join 会让 axios 组出的 URL 在空格/中文处错位（后端收到的 path 与库里对不上 404）。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = queryStr(req.query.id);
  const assetPath = joinEncodedSegments(req.query.path as string[] | string | undefined);
  if (!assetPath) {
    return res.status(400).json({ detail: "asset path required" });
  }
  return proxySkillsApi(req, res, {
    path: `/api/v1/skills/${encodeURIComponent(id)}/assets/${assetPath}`,
    allow: ["PUT", "DELETE"],
    largeBody: true,
  });
}

// 单文件 20MB → base64 约 27MB；留出 JSON 包裹余量
export const config = {
  api: { bodyParser: { sizeLimit: "32mb" } },
};
