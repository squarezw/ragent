import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import axios from "axios";
import pool from "@/lib/db";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  if (req.method === "GET") {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `
        SELECT
          d.id,
          d.name,
          d.description,
          d.settings,
          d.created_at,
          d.updated_at,
          d.visibility,
          d.owner_dept_id,
          d.owner_tenant_id,
          d.user_id,
          dept.name AS owner_dept_name,
          tenant.name AS owner_tenant_name,
          u.nickname AS owner_name,
          COUNT(kf.id) AS file_count
        FROM datasets d
        LEFT JOIN dept ON d.owner_dept_id = dept.id
        LEFT JOIN tenant ON d.owner_tenant_id = tenant.id
        LEFT JOIN users u ON d.user_id = u.id
        LEFT JOIN knowledge_files kf
          ON d.id = kf.dataset_id AND kf.status <> 'deleted'
        WHERE can_access_dataset($1, d.id)
        GROUP BY
          d.id, d.name, d.description, d.settings, d.created_at, d.updated_at,
          d.visibility, d.owner_dept_id, d.owner_tenant_id, d.user_id,
          dept.name, tenant.name, u.nickname
        ORDER BY d.created_at DESC
        `,
        [userId]
      );

      const datasets = result.rows.map((row) => ({
        ...row,
        file_count: parseInt(row.file_count),
      }));

      return res.json(datasets);
    } catch (error: any) {
      console.error("获取数据集列表失败:", error);
      return res.status(500).json({
        error: "获取数据集列表失败",
        details: error.message,
      });
    } finally {
      client.release();
    }
  } else if (req.method === "POST") {
    // 创建新数据集
    try {
      const {
        name,
        description,
        settings,
        visibility = "private",
        owner_dept_id,
        owner_tenant_id,
      } = req.body;

      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "数据集名称不能为空" });
      }

      if (!["private", "dept", "tenant", "public"].includes(visibility)) {
        return res.status(400).json({ error: "无效的可见性设置" });
      }

      // 调用 Python 后端创建数据集
      const response = await axios.post(
        `${EXTERNAL_API_BASE_URL}/api/v1/datasets`,
        {
          name,
          description,
          settings,
          visibility,
          owner_dept_id,
          owner_tenant_id,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.authorization,
          },
          timeout: 30000,
          validateStatus: (status) => status < 500,
        }
      );

      if (response.status >= 400) {
        return res.status(response.status).json({
          error: response.data?.message || "创建数据集失败",
          details: response.data,
        });
      }

      res.status(201).json(response.data);
    } catch (error: any) {
      console.error("创建数据集失败:", error);

      // 分类错误类型
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
          error: error.response.data?.message || "创建数据集失败",
          details: error.response.data,
        });
      } else {
        return res.status(500).json({
          error: "创建数据集失败",
          details: error.message,
        });
      }
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
