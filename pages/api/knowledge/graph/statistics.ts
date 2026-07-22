import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { requireAuth, getUserIdFromRequest } from "@/lib/auth";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

/**
 * 获取知识图谱的实体数和关系数统计
 * GET /api/knowledge/graph/statistics
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) {
    return;
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/statistics/graph`, {
      headers: {
        accept: "application/json",
        // Note: Python backend doesn't require auth for this endpoint based on the curl example
        // but we'll pass it anyway for consistency
        Authorization: req.headers.authorization,
      },
      timeout: 30000,
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 400) {
      return res.status(response.status).json({
        error: response.data?.message || "获取图谱统计失败",
        details: response.data,
      });
    }

    // 返回统计数据，格式为 {status: "success", data: {entityCount, relationCount, vectorDbSizeBytes}, message: "..."}
    res.status(200).json(response.data);
  } catch (error: any) {
    console.error("[Graph Statistics] Error:", error);

    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      return res.status(500).json({
        error: "统计服务连接失败",
        details: error.message,
      });
    } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      return res.status(500).json({
        error: "统计服务请求超时",
        details: error.message,
      });
    } else if (error.response?.status) {
      return res.status(error.response.status).json({
        error: error.response.data?.message || "获取图谱统计失败",
        details: error.response.data,
      });
    } else {
      return res.status(500).json({
        error: "获取图谱统计失败",
        details: error.message,
      });
    }
  }
}
