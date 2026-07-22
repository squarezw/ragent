import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8000";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ detail: "Unauthorized" });
    }

    // 从请求头中获取 Authorization token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ detail: "Authorization header required" });
    }

    // 调用 Python 后端接口
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/wechat/agents`, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error("Error fetching wechat agents:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        detail: error.response.data?.detail || "Failed to fetch wechat agents",
      });
    }

    return res.status(500).json({ detail: "Internal server error" });
  }
}
