import type { NextApiRequest, NextApiResponse } from "next";
import axios from "@/lib/axios";
import { requireAuth } from "@/lib/auth";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!EXTERNAL_API_BASE_URL) {
    return res.status(500).json({ error: "External API not configured" });
  }

  const { detail_id, vote_good, vote_bad, feedback } = req.body;

  if (!detail_id) {
    return res.status(400).json({ error: "Missing detail_id" });
  }

  // 转换参数格式：从 vote_good/vote_bad 转换为 action
  const action = vote_good ? "good" : "bad";
  const content = feedback || undefined;

  try {
    // 调用 Python 后端的 feedback 接口
    const response = await axios.post(
      `${EXTERNAL_API_BASE_URL}/api/v1/feedback/submit`,
      {
        detail_id,
        action,
        content,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(200).json(response.data);
  } catch (e: any) {
    console.error("[Feedback] External API error:", e);
    const statusCode = e?.response?.status || 500;

    res.status(statusCode).json({
      error: "Feedback submission failed",
      details: e?.response?.data?.detail || e?.message || e,
    });
  }
}
