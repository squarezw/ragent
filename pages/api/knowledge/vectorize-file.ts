import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { fileId, force } = req.body;

  if (!fileId) {
    return res.status(400).json({ error: "fileId is required" });
  }

  try {
    // 检查用户是否有权限对该文件进行分段
    const client = await pool.connect();
    try {
      // 查找文件记录和文件创建者的租户信息
      const dbRes = await client.query(
        `
        SELECT kf.user_id, 
               u_file.tenant_id as file_tenant_id
        FROM knowledge_files kf
        LEFT JOIN users u_file ON kf.user_id = u_file.id
        WHERE kf.id = $1
      `,
        [fileId]
      );

      if (dbRes.rows.length === 0) {
        return res.status(404).json({ error: "文件不存在" });
      }

      const file = dbRes.rows[0];
      const fileOwnerId = file.user_id;
      const fileTenantId = file.file_tenant_id;

      // 检查用户是否有权限分段该文件
      if (fileOwnerId !== userId) {
        // 检查用户是否是超级管理员或租户管理员
        const userRolesResult = await client.query(
          `
          SELECT u.tenant_id,
                 array_agg(r.name) as roles
          FROM users u
          LEFT JOIN user_roles ur ON u.id = ur.user_id
          LEFT JOIN roles r ON ur.role_id = r.id
          WHERE u.id = $1
          GROUP BY u.id, u.tenant_id
        `,
          [userId]
        );

        if (userRolesResult.rows.length === 0) {
          return res.status(403).json({ error: "只有文件所有者、管理员可以处理此文件" });
        }

        const user = userRolesResult.rows[0];
        const userRoles = user.roles || [];
        const userTenantId = user.tenant_id;

        // 超级管理员可以分段所有文件
        if (userRoles.includes("超级管理员")) {
          // 允许分段
        }
        // 租户管理员可以分段同租户内的文件
        else if (
          userRoles.includes("租户管理员") &&
          fileTenantId &&
          userTenantId === fileTenantId
        ) {
          // 允许分段
        } else {
          return res.status(403).json({ error: "只有文件所有者、管理员可以处理此文件" });
        }
      }
    } finally {
      client.release();
    }
    // 构建请求头，透传认证信息
    const headers: any = {
      "Content-Type": "application/json",
    };

    // 从请求中获取认证 token 并透传给微服务
    if (req.headers && req.headers.authorization) {
      headers["Authorization"] = req.headers.authorization;
    }

    // 调用微服务后端进行向量化
    const requestBody = {
      force: force || false, // 传递强制重新分段参数
    };

    const response = await axios.post(
      `${EXTERNAL_API_BASE_URL}/api/v1/files/${fileId}/embed`,
      requestBody,
      {
        timeout: 60000,
        headers,
      }
    );

    // 直接返回微服务的响应
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    console.error("[Vectorize File] Error:", error);

    // 分类错误类型
    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      return res.status(503).json({
        error: "Vectorization service unavailable",
        message: "Please check if the Python backend service is running.",
      });
    } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      return res.status(504).json({
        error: "Vectorization request timed out",
        message: "The service may be overloaded.",
      });
    } else if (error.response?.status) {
      return res.status(error.response.status).json({
        error: "Vectorization service error",
        message: error.response.data?.message || error.message,
      });
    } else {
      return res.status(500).json({
        error: "Vectorization failed",
        message: error.message || "Unknown error",
      });
    }
  }
}
