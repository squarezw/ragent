import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { requireAuth, getUserIdFromRequest } from "@/lib/auth";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

/**
 * 查询异步任务的执行状态和结果
 * GET /api/datasets/tasks/[task_id]
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

  const { task_id } = req.query;
  if (!task_id || typeof task_id !== "string") {
    return res.status(400).json({ error: "Missing or invalid task_id" });
  }

  try {
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/datasets/tasks/${task_id}`, {
      headers: {
        accept: "application/json",
        Authorization: req.headers.authorization,
      },
      timeout: 30000,
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 400) {
      return res.status(response.status).json({
        error: response.data?.message || "查询任务状态失败",
        details: response.data,
      });
    }

    // 返回任务状态，格式为 {success: true, task: {...}}
    res.status(200).json(response.data);
  } catch (error: any) {
    console.error("[Task Status] Error:", error);

    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      return res.status(500).json({
        error: "任务服务连接失败",
        details: error.message,
      });
    } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      return res.status(500).json({
        error: "任务服务请求超时",
        details: error.message,
      });
    } else if (error.response?.status) {
      return res.status(error.response.status).json({
        error: error.response.data?.message || "查询任务状态失败",
        details: error.response.data,
      });
    } else {
      return res.status(500).json({
        error: "查询任务状态失败",
        details: error.message,
      });
    }
  }
}
