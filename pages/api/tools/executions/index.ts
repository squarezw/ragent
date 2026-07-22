import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const BACKEND_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req;

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
        // 查询工具执行记录
        const { tool_id, app_id, status, start_date, end_date, page, page_size } = req.query;
        const params = new URLSearchParams();
        if (tool_id) params.append("tool_id", tool_id as string);
        if (app_id) params.append("app_id", app_id as string);
        if (status) params.append("status", status as string);
        if (start_date) params.append("start_date", start_date as string);
        if (end_date) params.append("end_date", end_date as string);
        if (page) params.append("page", page as string);
        if (page_size) params.append("page_size", page_size as string);

        const response = await axios.get(
          `${BACKEND_URL}/api/v1/tools/executions${params.toString() ? `?${params.toString()}` : ""}`,
          { headers }
        );

        return res.status(200).json(response.data);
      }

      default:
        res.setHeader("Allow", ["GET"]);
        return res.status(405).json({ error: `Method ${method} Not Allowed` });
    }
  } catch (error: any) {
    console.error("Tool Executions API error:", error.response?.data || error.message);

    // 处理 FastAPI 验证错误（422）
    if (error.response?.status === 422 && error.response?.data?.detail) {
      const detail = error.response.data.detail;
      // FastAPI 的 detail 可能是数组（验证错误）或字符串
      if (Array.isArray(detail)) {
        const errorMessages = detail
          .map((err: any) => `${err.loc?.join(".") || "field"}: ${err.msg}`)
          .join("; ");
        return res.status(422).json({
          error: `参数验证失败: ${errorMessages}`,
        });
      }
    }

    return res.status(error.response?.status || 500).json({
      error: error.response?.data?.detail || error.message || "Internal server error",
    });
  }
}
