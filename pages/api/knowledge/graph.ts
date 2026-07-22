import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { requireAuth, getUserIdFromRequest } from "@/lib/auth";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) {
    return;
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  if (req.method === "GET") {
    // 获取指定数据集的知识图谱数据
    // /api/knowledge/graph?dataset_id=xxx
    const { dataset_id } = req.query;
    if (!dataset_id) {
      return res.status(400).json({ error: "Missing dataset_id" });
    }

    try {
      const response = await axios.get(
        `${EXTERNAL_API_BASE_URL}/api/v1/datasets/${dataset_id}/graph`,
        {
          headers: {
            accept: "application/json",
            Authorization: req.headers.authorization,
          },
          timeout: 30000,
          validateStatus: (status) => status < 500,
        }
      );

      if (response.status >= 400) {
        return res.status(response.status).json({
          error: response.data?.message || "获取图谱数据失败",
          details: response.data,
        });
      }

      // 返回图谱数据，格式为 {triples: [...]}
      res.status(200).json(response.data);
    } catch (error: any) {
      console.error("[Graph GET] Error:", error);

      if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
        return res.status(500).json({
          error: "图谱服务连接失败",
          details: error.message,
        });
      } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
        return res.status(500).json({
          error: "图谱服务请求超时",
          details: error.message,
        });
      } else if (error.response?.status) {
        return res.status(error.response.status).json({
          error: error.response.data?.message || "获取图谱数据失败",
          details: error.response.data,
        });
      } else {
        return res.status(500).json({
          error: "获取图谱数据失败",
          details: error.message,
        });
      }
    }
  } else if (req.method === "POST") {
    // 为指定数据集创建知识图谱（异步任务）
    // /api/knowledge/graph?id=xxx
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: "Missing dataset_id" });
    }

    try {
      const response = await axios.post(
        `${EXTERNAL_API_BASE_URL}/api/v1/datasets/${id}/graph`,
        {},
        {
          headers: {
            accept: "application/json",
            Authorization: req.headers.authorization,
          },
          timeout: 30000,
          validateStatus: (status) => status < 500,
        }
      );

      if (response.status >= 400) {
        return res.status(response.status).json({
          error: response.data?.message || "创建图谱任务失败",
          details: response.data,
        });
      }

      // 返回任务信息，格式为 {success: true, task_id: "...", message: "..."}
      res.status(200).json(response.data);
    } catch (error: any) {
      console.error("[Graph POST] Error:", error);

      if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
        return res.status(500).json({
          error: "图谱服务连接失败",
          details: error.message,
        });
      } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
        return res.status(500).json({
          error: "图谱服务请求超时",
          details: error.message,
        });
      } else if (error.response?.status) {
        return res.status(error.response.status).json({
          error: error.response.data?.message || "创建图谱任务失败",
          details: error.response.data,
        });
      } else {
        return res.status(500).json({
          error: "创建图谱任务失败",
          details: error.message,
        });
      }
    }
  } else if (req.method === "DELETE") {
    // 删除指定数据集的知识图谱数据
    // /api/knowledge/graph?dataset_id=xxx
    // 或删除所有图谱数据: /api/knowledge/graph?all=1
    const { dataset_id, all } = req.query;

    // 清空所有数据集的图谱（系统设置页面使用）
    if (all === "1") {
      try {
        // 获取所有数据集列表
        const datasetsRes = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/datasets`, {
          headers: {
            accept: "application/json",
            Authorization: req.headers.authorization,
          },
          timeout: 30000,
          validateStatus: (status) => status < 500,
        });

        if (datasetsRes.status >= 400) {
          return res.status(datasetsRes.status).json({
            error: datasetsRes.data?.message || "获取数据集列表失败",
            details: datasetsRes.data,
          });
        }

        const datasets = Array.isArray(datasetsRes.data)
          ? datasetsRes.data
          : datasetsRes.data?.datasets || [];

        // 遍历删除每个数据集的图谱
        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        for (const dataset of datasets) {
          try {
            await axios.delete(`${EXTERNAL_API_BASE_URL}/api/v1/datasets/${dataset.id}/graph`, {
              headers: {
                accept: "application/json",
                Authorization: req.headers.authorization,
              },
              timeout: 30000,
              validateStatus: (status) => status < 500,
            });
            successCount++;
          } catch (error: any) {
            failCount++;
            errors.push(`${dataset.name}: ${error.message}`);
            console.error(`删除数据集 ${dataset.id} 的图谱失败:`, error);
          }
        }

        return res.status(200).json({
          success: true,
          message: `成功清空 ${successCount} 个数据集的图谱${failCount > 0 ? `，${failCount} 个失败` : ""}`,
          details: {
            total: datasets.length,
            success: successCount,
            failed: failCount,
            errors: errors.length > 0 ? errors : undefined,
          },
        });
      } catch (error: any) {
        console.error("[Graph DELETE ALL] Error:", error);
        return res.status(500).json({
          error: "清空所有图谱失败",
          details: error.message,
        });
      }
    }

    if (!dataset_id) {
      return res.status(400).json({ error: "Missing dataset_id" });
    }

    try {
      const response = await axios.delete(
        `${EXTERNAL_API_BASE_URL}/api/v1/datasets/${dataset_id}/graph`,
        {
          headers: {
            accept: "application/json",
            Authorization: req.headers.authorization,
          },
          timeout: 30000,
          validateStatus: (status) => status < 500,
        }
      );

      if (response.status >= 400) {
        return res.status(response.status).json({
          error: response.data?.message || "删除图谱数据失败",
          details: response.data,
        });
      }

      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("[Graph DELETE] Error:", error);

      if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
        return res.status(500).json({
          error: "图谱服务连接失败",
          details: error.message,
        });
      } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
        return res.status(500).json({
          error: "图谱服务请求超时",
          details: error.message,
        });
      } else if (error.response?.status) {
        return res.status(error.response.status).json({
          error: error.response.data?.message || "删除图谱数据失败",
          details: error.response.data,
        });
      } else {
        return res.status(500).json({
          error: "删除图谱数据失败",
          details: error.message,
        });
      }
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
