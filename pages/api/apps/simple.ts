import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

interface SimpleApp {
  id: number;
  name: string;
  dataset_ids: string[];
  is_default?: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 从请求头中获取 Authorization token
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Authorization header required" });
  }

  try {
    // 构建查询参数
    const params = new URLSearchParams();
    params.append("app_type", "Chat");
    params.append("platform", "Web");
    params.append("is_simple", "true"); // 简化返回结果
    // 可选：添加分页参数
    if (req.query.skip) params.append("skip", req.query.skip as string);
    if (req.query.limit) params.append("limit", req.query.limit as string);

    const queryString = params.toString();
    const url = `${EXTERNAL_API_BASE_URL}/api/v1/apps${queryString ? `?${queryString}` : ""}`;

    // 调用 Python 后端接口
    const response = await axios.get(url, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        accept: "application/json",
      },
    });

    // Python 后端返回格式: { total: number, items: [...] }
    const apps: SimpleApp[] = Array.isArray(response.data?.items)
      ? response.data.items
      : Array.isArray(response.data)
        ? response.data
        : [];

    // 返回格式与原来保持一致
    return res.status(200).json({
      items: apps,
    });
  } catch (error: any) {
    console.error("Error fetching apps:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        error:
          error.response.data?.detail || error.response.data?.message || "Failed to fetch apps",
      });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
}
