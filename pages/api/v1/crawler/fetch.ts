import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization as string;
  }

  try {
    const response = await axios.post(`${EXTERNAL_API_BASE_URL}/api/v1/crawler/fetch`, req.body, {
      headers,
      timeout: 60000,
    });

    return res.status(response.status).json(response.data);
  } catch (error: any) {
    console.error("[Crawler Fetch] Error:", error.message || error);

    if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") {
      return res.status(503).json({
        error: "Crawler service unavailable",
        message: "无法连接爬虫服务，请确认 Python 服务是否启动。",
      });
    }

    if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      return res.status(504).json({
        error: "Crawler request timed out",
        message: "爬虫服务响应超时，请稍后重试。",
      });
    }

    if (error.response?.status) {
      return res
        .status(error.response.status)
        .json(error.response.data || { error: "Crawler service error" });
    }

    return res.status(500).json({
      error: "Crawler fetch failed",
      message: error.message || "未知错误",
    });
  }
}
