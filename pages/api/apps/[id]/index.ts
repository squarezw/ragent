import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method, query } = req;
  const { id } = query;

  try {
    // 支持从多个来源获取 token：Authorization 头、cookie、或 X-API-Key
    let token = req.cookies.ragent_token;
    const authHeader = req.headers.authorization;
    const apiKey = req.headers["x-api-key"];

    // 优先使用 Authorization 头中的 token
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }

    const headers: any = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    } else if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    switch (method) {
      case "GET": {
        // 获取应用信息
        const response = await axios.get(`${BACKEND_URL}/api/v1/apps/${id}`, { headers });
        return res.status(200).json(response.data);
      }

      default:
        res.setHeader("Allow", ["GET"]);
        return res.status(405).json({ error: `Method ${method} Not Allowed` });
    }
  } catch (error: any) {
    console.error("App API error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: error.response?.data?.detail || error.message || "Internal server error",
    });
  }
}
