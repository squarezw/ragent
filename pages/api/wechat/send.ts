import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { requireAuth, getUserIdFromRequest } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    // 验证用户身份
    if (!requireAuth(req, res)) {
      return;
    }

    // 检查是否为超级管理员
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const isSuper = await isSuperAdmin(userId);
    if (!isSuper) {
      return res.status(403).json({
        success: false,
        message: "只有超级管理员可以使用微信发送功能",
      });
    }

    const { touser, msgtype, text, agentid } = req.body;

    // 验证请求参数
    if (!touser || !msgtype || !text || !agentid) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: touser, msgtype, text, agentid",
      });
    }

    if (msgtype !== "text") {
      return res.status(400).json({
        success: false,
        message: "Only text message type is supported",
      });
    }

    if (!text.content) {
      return res.status(400).json({
        success: false,
        message: "Text content is required",
      });
    }

    // 从请求头获取Authorization token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header required" });
    }

    // 构建请求体
    const requestBody = {
      touser,
      msgtype,
      agentid,
      text,
    };

    // 转发请求到外部API
    const response = await axios.post(`${EXTERNAL_API_BASE_URL}/api/v1/wechat/send`, requestBody, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      timeout: 30000, // 30秒超时
    });

    // 直接返回外部API的响应
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    console.error("WeChat send message error:", error);

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
