import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "数据集ID不能为空" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Authorization header required" });
  }

  if (req.method === "GET") {
    // 获取单个数据集详情
    try {
      const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/datasets/${id}`, {
        headers: {
          accept: "application/json",
          Authorization: authHeader,
        },
        timeout: 30000,
        validateStatus: (status) => status < 500,
      });

      if (response.status >= 400) {
        return res.status(response.status).json({
          error: response.data?.detail || response.data?.message || "获取数据集详情失败",
          details: response.data,
        });
      }

      res.json(response.data);
    } catch (error: any) {
      console.error("获取数据集详情失败:", error);
      return handleAxiosError(error, res, "获取数据集详情失败");
    }
  } else if (req.method === "PUT") {
    // 更新数据集
    try {
      const response = await axios.put(`${EXTERNAL_API_BASE_URL}/api/v1/datasets/${id}`, req.body, {
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        timeout: 30000,
        validateStatus: (status) => status < 500,
      });

      if (response.status >= 400) {
        return res.status(response.status).json({
          error: response.data?.detail || response.data?.message || "更新数据集失败",
          details: response.data,
        });
      }

      res.json(response.data);
    } catch (error: any) {
      console.error("更新数据集失败:", error);
      return handleAxiosError(error, res, "更新数据集失败");
    }
  } else if (req.method === "DELETE") {
    // 删除数据集
    try {
      const response = await axios.delete(`${EXTERNAL_API_BASE_URL}/api/v1/datasets/${id}`, {
        headers: {
          Authorization: authHeader,
        },
        timeout: 30000,
        validateStatus: (status) => status < 500,
      });

      if (response.status >= 400) {
        return res.status(response.status).json({
          error: response.data?.detail || response.data?.message || "删除数据集失败",
          details: response.data,
        });
      }

      // 对于 204 No Content 或成功删除的响应
      if (response.status === 204) {
        return res.status(204).end();
      }

      res.json(response.data || { message: "数据集删除成功" });
    } catch (error: any) {
      console.error("删除数据集失败:", error);
      return handleAxiosError(error, res, "删除数据集失败");
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}

function handleAxiosError(error: any, res: NextApiResponse, defaultMessage: string) {
  if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
    return res.status(500).json({
      error: "数据集服务连接失败",
      details: error.message,
    });
  } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
    return res.status(500).json({
      error: "数据集服务请求超时",
      details: error.message,
    });
  } else if (error.response?.status) {
    return res.status(error.response.status).json({
      error: error.response.data?.detail || error.response.data?.message || defaultMessage,
      details: error.response.data,
    });
  } else {
    return res.status(500).json({
      error: defaultMessage,
      details: error.message,
    });
  }
}
