import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";

const BACKEND_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method, query } = req;
  const { id: appId, toolId } = query;

  try {
    // 验证用户身份
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ detail: "Unauthorized" });
    }

    // 检查是否为超级管理员
    const isSuperAdminUser = await isSuperAdmin(userId);
    if (!isSuperAdminUser) {
      return res.status(403).json({ error: "只有超级管理员才能操作工具" });
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
      case "DELETE": {
        // 解绑工具
        await axios.delete(`${BACKEND_URL}/api/v1/apps/${appId}/tools/${toolId}`, { headers });
        return res.status(200).json({ message: "Tool unbound successfully" });
      }

      default:
        res.setHeader("Allow", ["DELETE"]);
        return res.status(405).json({ error: `Method ${method} Not Allowed` });
    }
  } catch (error: any) {
    console.error("App Tool API error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: error.response?.data?.detail || error.message || "Internal server error",
    });
  }
}
