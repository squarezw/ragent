import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getTokenFromRequest, getUserIdFromRequest } from "@/lib/auth";

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

    // 应用写权限由后端 require_app_owner_or_super 统一校验，
    // 普通创建者可管理自己应用的工具；不可只按平台角色拦截。

    // 使用与身份验证相同的 token，兼容统一登录的 HttpOnly cookie。
    const token = getTokenFromRequest(req);
    const authHeader = token ? `Bearer ${token}` : undefined;
    const apiKey = req.headers["x-api-key"];

    const headers: any = {
      ...(process.env.WORKSPACE_TENANT_ENABLED === "true" && typeof req.headers["x-workspace-tenant-id"] === "string" ? { "X-Workspace-Tenant-ID": String(req.headers["x-workspace-tenant-id"]) } : {}),
      "Content-Type": "application/json",
    };

    if (authHeader) {
      headers.Authorization = authHeader;
    } else if (apiKey) {
      headers["X-API-Key"] = apiKey;
    } else {
      return res.status(401).json({ detail: "Authorization header required" });
    }

    switch (method) {
      case "PUT": {
        // 更新应用的工具配置（custom_config / priority）。
        // 权限（owner 或超管）由后端 require_app_owner_or_super 校验，
        // 代理只做身份透传——这里重复实现一遍所有权判断只会两处漂移。
        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
        const payload: Record<string, unknown> = {};
        if (body.custom_config !== undefined) payload.custom_config = body.custom_config;
        if (body.priority !== undefined) payload.priority = body.priority;
        if (Object.keys(payload).length === 0) {
          return res.status(400).json({ error: "custom_config 或 priority 至少传一项" });
        }
        const updated = await axios.put(
          `${BACKEND_URL}/api/v1/apps/${appId}/tools/${toolId}`,
          payload,
          { headers }
        );
        return res.status(200).json(updated.data);
      }

      case "DELETE": {
        // 解绑工具
        await axios.delete(`${BACKEND_URL}/api/v1/apps/${appId}/tools/${toolId}`, { headers });
        return res.status(200).json({ message: "Tool unbound successfully" });
      }

      default:
        res.setHeader("Allow", ["PUT", "DELETE"]);
        return res.status(405).json({ error: `Method ${method} Not Allowed` });
    }
  } catch (error: any) {
    console.error("App Tool API error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: error.response?.data?.detail || error.message || "Internal server error",
    });
  }
}
