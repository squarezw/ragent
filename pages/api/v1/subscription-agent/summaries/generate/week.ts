import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/auth";
import { generateWeeklySummary } from "@/lib/subscription-agent/generate-summary";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authResult = await requireAuth(req, res);
  if (!authResult) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ message: `不支持的请求方法: ${req.method}` });
  }

  try {
    const { feedIds, topic, webhook_url } = req.body;
    const data = await generateWeeklySummary({ feedIds, topic, webhook_url });
    return res.status(200).json(data);
  } catch (error: any) {
    console.error("Subscription Agent API error:", error);
    return res.status(500).json({ message: error.message || "服务请求失败" });
  }
}
