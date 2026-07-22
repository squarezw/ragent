import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    // 从请求头获取Authorization token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header required" });
    }

    // 转发请求到外部API
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/wechat/oauth/authorize`, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      timeout: 30000, // 30秒超时
    });

    // 直接返回外部API的响应
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    console.error("WeChat OAuth authorize error:", error);

    if (error.response) {
      // 外部API返回了错误响应
      return res.status(error.response.status).json({
        success: false,
        message: error.response.data?.message || "External API error",
        error: error.response.data,
      });
    } else if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") {
      return res.status(503).json({
        success: false,
        message: "External WeChat service unavailable",
        error: "Connection failed",
      });
    } else if (error.code === "ETIMEDOUT") {
      return res.status(504).json({
        success: false,
        message: "External WeChat service timeout",
        error: "Request timeout",
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }
}
