import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { requireAuth, getUserIdFromRequest } from "@/lib/auth";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

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

  const { taskId } = req.query;
  if (!taskId || typeof taskId !== "string") {
    return res.status(400).json({ error: "Missing or invalid taskId" });
  }

  try {
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/stt/tasks/${taskId}`, {
      headers: {
        accept: "application/json",
        Authorization: req.headers.authorization,
      },
      timeout: 30000,
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 400) {
      return res.status(response.status).json({
        error: response.data?.message || "Failed to query STT task status",
        details: response.data,
      });
    }

    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error("[STT Task Status] Error:", error);

    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      return res.status(500).json({
        error: "STT service connection failed",
        details: error.message,
      });
    } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      return res.status(500).json({
        error: "STT service request timeout",
        details: error.message,
      });
    } else if (error.response?.status) {
      return res.status(error.response.status).json({
        error: error.response.data?.message || "Failed to query STT task status",
        details: error.response.data,
      });
    } else {
      return res.status(500).json({
        error: "Failed to query STT task status",
        details: error.message,
      });
    }
  }
}
