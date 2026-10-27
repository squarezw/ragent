import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  const code = req.query.code;
  if (typeof code !== "string" || !/^custom-[a-f0-9-]+$/i.test(code))
    return res.status(400).json({ detail: "Invalid model code" });
  return proxySkillsApi(req, res, {
    path: `/api/v1/llm-models/custom/${encodeURIComponent(code)}`,
    allow: ["PATCH", "DELETE"],
  });
}
