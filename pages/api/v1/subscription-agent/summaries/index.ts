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

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ message: `不支持的请求方法: ${req.method}` });
  }

  try {
    const { page = "1", pageSize = "20", type, status, feedIds } = req.query;

    // GET /api/v1/stream-agent/summaries - 获取报告列表
    const queryParams = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });

    if (type) {
      queryParams.append("type", String(type));
    }

    if (status) {
      queryParams.append("status", String(status));
    }

    if (feedIds) {
      // feedIds 可以是数组或逗号分隔的字符串
      const feedIdArray = Array.isArray(feedIds) ? feedIds : String(feedIds).split(",");
      feedIdArray.forEach((id) => queryParams.append("feedIds", id));
    }

    const response = await fetch(`${SUBSCRIPTION_AGENT_API_URL}/api/summaries?${queryParams}`, {
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
  } catch (error: any) {
    console.error("Subscription Agent API error:", error);
    return res.status(500).json({ message: error.message || "服务请求失败" });
  }
}
