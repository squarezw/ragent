import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const BACKEND_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method, query } = req;
  const { id: appId } = query;

  try {
    // 验证用户身份
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ detail: "Unauthorized" });
    }

    // 从请求头中获取 Authorization token
    const authHeader = req.headers.authorization;
    const apiKey = req.headers["x-api-key"];

    const headers: any = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    } else if (authHeader) {
      headers.Authorization = authHeader;
    } else {
      return res.status(401).json({ detail: "Authorization header required" });
    }

    switch (method) {
      case "GET": {
        // 获取应用的工具列表
        const { is_enabled } = req.query;
        const params = new URLSearchParams();
        if (is_enabled !== undefined) params.append("is_enabled", is_enabled as string);

        const response = await axios.get(
          `${BACKEND_URL}/api/v1/apps/${appId}/tools${params.toString() ? `?${params.toString()}` : ""}`,
          { headers }
        );

        return res.status(200).json(response.data);
      }

      case "POST": {
        // 为应用绑定工具
        const response = await axios.post(`${BACKEND_URL}/api/v1/apps/${appId}/tools`, req.body, {
          headers,
        });
        return res.status(201).json(response.data);
      }

      default:
        res.setHeader("Allow", ["GET", "POST"]);
        return res.status(405).json({ error: `Method ${method} Not Allowed` });
    }
  } catch (error: any) {
    console.error("App Tools API error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: error.response?.data?.detail || error.message || "Internal server error",
    });
  }
}
