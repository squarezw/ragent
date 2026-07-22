import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

/**
 * 获取向量数据库和知识图谱的统计信息
 * 调用 Python 后端的统计接口
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // 调用 Python 后端的统计接口
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/statistics/graph`, {
      headers: {
        accept: "application/json",
        // 监控接口可能不需要认证，但保持一致性
        Authorization: req.headers.authorization,
      },
      timeout: 30000,
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 400) {
      return res.status(response.status).json({
        error: response.data?.message || "获取统计信息失败",
        details: response.data,
      });
    }

    // Python 后端返回格式：{status: "success", data: {entityCount, relationCount, vectorDbSizeBytes}}
    const data = response.data?.data || response.data;
    res.status(200).json({
      vectorDbSizeBytes: data.vectorDbSizeBytes || 0,
      entityCount: data.entityCount || 0,
      relationCount: data.relationCount || 0,
    });
  } catch (e: any) {
    console.error("[Monitoring] Error:", e);

    if (e.code === "ECONNRESET" || e.code === "ECONNREFUSED") {
      return res.status(500).json({
        error: "统计服务连接失败",
        details: e.message,
      });
    } else if (e.code === "ETIMEDOUT" || e.message?.includes("timeout")) {
      return res.status(500).json({
        error: "统计服务请求超时",
        details: e.message,
      });
    } else if (e.response?.status) {
      return res.status(e.response.status).json({
        error: e.response.data?.message || "获取统计信息失败",
        details: e.response.data,
      });
    } else {
      return res.status(500).json({
        error: "获取统计信息失败",
        details: e.message,
      });
    }
  }
}
