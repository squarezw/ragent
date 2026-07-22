import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/auth";

const SUBSCRIPTION_AGENT_API_URL = process.env.SUBSCRIPTION_AGENT_API_URL;
const SUBSCRIPTION_AGENT_API_KEY = process.env.SUBSCRIPTION_AGENT_API_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authResult = await requireAuth(req, res);
  if (!authResult) return;

  if (!SUBSCRIPTION_AGENT_API_URL || !SUBSCRIPTION_AGENT_API_KEY) {
    return res.status(500).json({ message: "Subscription Agent 服务未配置" });
  }

  try {
    if (req.method === "GET") {
      // GET /api/v1/stream-agent/feeds - 获取订阅列表
      const response = await fetch(`${SUBSCRIPTION_AGENT_API_URL}/api/feeds`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SUBSCRIPTION_AGENT_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const error = await response.text();
        return res.status(response.status).json({ message: error });
      }

      const data = await response.json();
      return res.status(200).json(data);
    } else if (req.method === "POST") {
      // POST /api/v1/stream-agent/feeds - 创建订阅
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({ message: "订阅 URL 不能为空" });
      }

      const response = await fetch(`${SUBSCRIPTION_AGENT_API_URL}/api/feeds`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUBSCRIPTION_AGENT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const error = await response.text();
        return res.status(response.status).json({ message: error });
      }

      const data = await response.json();
      return res.status(201).json(data);
    } else {
      res.setHeader("Allow", ["GET", "POST"]);
      return res.status(405).json({ message: `不支持的请求方法: ${req.method}` });
    }
  } catch (error: any) {
    console.error("Subscription Agent API error:", error);
    return res.status(500).json({ message: error.message || "服务请求失败" });
  }
}
