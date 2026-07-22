import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8000";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return handleGet(req, res);
  } else if (req.method === "POST") {
    return handlePost(req, res);
  } else {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }
}

// 获取应用列表
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
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

    // 构建查询参数
    const { skip, limit, app_type, platform } = req.query;
    const params = new URLSearchParams();
    if (skip) params.append("skip", skip as string);
    if (limit) params.append("limit", limit as string);
    if (app_type) params.append("app_type", app_type as string);
    if (platform) params.append("platform", platform as string);

    const queryString = params.toString();
    const url = `${EXTERNAL_API_BASE_URL}/api/v1/apps${queryString ? `?${queryString}` : ""}`;

    // 调用 Python 后端接口
    const response = await axios.get(url, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error("Error fetching apps:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        detail: error.response.data?.detail || "Failed to fetch apps",
      });
    }

    return res.status(500).json({ detail: "Internal server error" });
  }
}

// 创建应用
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
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

    // 调用 Python 后端接口创建应用
    const response = await axios.post(`${EXTERNAL_API_BASE_URL}/api/v1/apps`, req.body, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    return res.status(201).json(response.data);
  } catch (error: any) {
    console.error("Error creating app:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        detail: error.response.data?.detail || "Failed to create app",
      });
    }

    return res.status(500).json({ detail: "Internal server error" });
  }
}
