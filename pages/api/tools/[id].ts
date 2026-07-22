import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const BACKEND_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method, query } = req;
  const { id } = query;

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
        // 获取工具详情
        const { include_statistics, include_app_tools } = req.query;
        const params = new URLSearchParams();
        if (include_statistics) params.append("include_statistics", include_statistics as string);
        if (include_app_tools) params.append("include_app_tools", include_app_tools as string);

        const response = await axios.get(
          `${BACKEND_URL}/api/v1/tools/${id}${params.toString() ? `?${params.toString()}` : ""}`,
          { headers }
        );

        return res.status(200).json(response.data);
      }

      case "PUT": {
        // 更新工具
        const response = await axios.put(`${BACKEND_URL}/api/v1/tools/${id}`, req.body, {
          headers,
        });
        return res.status(200).json(response.data);
      }

      case "DELETE": {
        // 删除工具
        await axios.delete(`${BACKEND_URL}/api/v1/tools/${id}`, { headers });
        return res.status(200).json({ message: "Tool deleted successfully" });
      }

      default:
        res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
        return res.status(405).json({ error: `Method ${method} Not Allowed` });
    }
  } catch (error: any) {
    console.error("Tool API error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: error.response?.data?.detail || error.message || "Internal server error",
    });
  }
}
