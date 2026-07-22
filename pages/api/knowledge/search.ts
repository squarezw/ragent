import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { requireAuth, getUserIdFromRequest } from "@/lib/auth";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) {
    return;
  }
  const user_id = getUserIdFromRequest(req);
  if (!user_id) {
    res.status(401).json({ error: "未登录" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { query, topN = 5, enableDeepSearch = false, dataset_id } = req.body || {};
  if (!query) {
    res.status(400).json({ error: "Missing query" });
    return;
  }
  if (!dataset_id) {
    res.status(400).json({ error: "Missing dataset_id" });
    return;
  }
  if (!EXTERNAL_API_BASE_URL) {
    res.status(500).json({ error: "External API not configured" });
    return;
  }

  try {
    // 调用 Python 后端的搜索接口
    const response = await axios.post(
      `${EXTERNAL_API_BASE_URL}/api/v1/datasets/${dataset_id}/search`,
      {
        query,
        topN,
        enableDeepSearch,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.authorization,
        },
        timeout: 30000,
        validateStatus: (status) => status < 500,
      }
    );

    if (response.status >= 400) {
      return res.status(response.status).json({
        error: response.data?.message || "搜索失败",
        details: response.data,
      });
    }

    // Python 后端返回格式可能是 {results: [...]} 或直接是数组
    const results = Array.isArray(response.data) ? response.data : response.data?.results || [];

    res.status(200).json({ results });
  } catch (e: any) {
    console.error("[Search] External API error:", e);

    // 分类错误类型
    if (e.code === "ECONNRESET" || e.code === "ECONNREFUSED") {
      return res.status(500).json({
        error: "搜索服务连接失败",
        details: e.message,
      });
    } else if (e.code === "ETIMEDOUT" || e.message?.includes("timeout")) {
      return res.status(500).json({
        error: "搜索服务请求超时",
        details: e.message,
      });
    } else if (e.response?.status) {
      return res.status(e.response.status).json({
        error: e.response.data?.message || "搜索失败",
        details: e.response.data?.detail || e.response.data,
      });
    } else {
      return res.status(500).json({
        error: "搜索失败",
        details: e?.message || e,
      });
    }
  }
}
