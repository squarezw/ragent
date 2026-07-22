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

  const { file_ids, force } = req.body;

  if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
    return res.status(400).json({ error: "file_ids array is required and cannot be empty" });
  }

  try {
    // 检查用户是否有权限对所有文件进行分段
    const client = await pool.connect();
    try {
      // 获取当前用户信息
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
        return res.status(403).json({ error: "用户信息不存在" });
      }

      const user = userRolesResult.rows[0];
      const userRoles = user.roles || [];
      const userTenantId = user.tenant_id;
      const isSuperAdmin = userRoles.includes("超级管理员");
      const isTenantAdmin = userRoles.includes("租户管理员");

      // 检查所有文件的权限
      const filesResult = await client.query(
        `
        SELECT kf.id, kf.user_id, 
               u_file.tenant_id as file_tenant_id
        FROM knowledge_files kf
        LEFT JOIN users u_file ON kf.user_id = u_file.id
        WHERE kf.id = ANY($1::int[])
      `,
        [file_ids]
      );

      if (filesResult.rows.length !== file_ids.length) {
        return res.status(404).json({ error: "部分文件不存在" });
      }

      // 检查每个文件的权限
      for (const file of filesResult.rows) {
        const fileOwnerId = file.user_id;
        const fileTenantId = file.file_tenant_id;

        // 如果是文件所有者，允许
        if (fileOwnerId === userId) {
          continue;
        }

        // 超级管理员可以分段所有文件
        if (isSuperAdmin) {
          continue;
        }

        // 租户管理员只能分段同租户内的文件
        if (isTenantAdmin && fileTenantId && userTenantId === fileTenantId) {
          continue;
        }

        // 没有权限
        return res.status(403).json({
          error: "只有文件所有者、超级管理员或租户管理员可以分段文件",
          message: `文件 ID ${file.id} 无权限分段`,
        });
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

    // 调用微服务后端进行批量向量化
    const requestBody = {
      file_ids: file_ids,
      force: force || false, // 传递强制重新分段参数
    };

    const response = await axios.post(`${EXTERNAL_API_BASE_URL}/api/v1/files/embed`, requestBody, {
      timeout: 120000, // 批量处理可能需要更长时间
      headers,
    });

    // 直接返回微服务的响应
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    console.error("[Batch Vectorize Files] Error:", error);
    if (error.response) {
      console.error("[Batch Vectorize Files] Response status:", error.response.status);
      console.error("[Batch Vectorize Files] Response data:", JSON.stringify(error.response.data));
    }
    console.error("[Batch Vectorize Files] Request body:", JSON.stringify(requestBody));

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
