import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const BACKEND_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

/**
 * GET /api/tools/builtin —— 内置工具清单（只读）。
 *
 * 内置工具（原生 + 网关）随代码发布，**不在 `tools` 表里**，所以工具管理页按 tool_type
 * 筛不出它们。授权判据也写在代码里（`sql_query` 仅超级管理员、`execute_skill` 看该应用
 * 绑了没绑 skill……），界面上改不了。这个端点把那份名册取出来供只读展示。
 *
 * **权限由后端判**（仅超级管理员）。这里不复制一份角色检查——前端只据此决定要不要显示
 * 那个筛选项，真正的门在服务端；把判定抄到前端就多了一处会漂的真源。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ detail: "Unauthorized" });
    }

    const authHeader = req.headers.authorization;
    const apiKey = req.headers["x-api-key"];
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["X-API-Key"] = apiKey as string;
    } else if (authHeader) {
      headers.Authorization = authHeader;
    } else {
      return res.status(401).json({ detail: "Authorization header required" });
    }

    const response = await axios.get(`${BACKEND_URL}/api/v1/tools/builtin`, { headers });
    return res.status(200).json(response.data);
  } catch (error) {
    // 同目录其它代理写的是 `catch (error: any)`；这里显式收窄，避免为了对齐风格
    // 而新增一条 noExplicitAny——行为完全一致。
    const e = error as {
      response?: { status?: number; data?: { detail?: string } };
      message?: string;
    };
    console.error("Builtin tools API error:", e.response?.data || e.message);
    return res.status(e.response?.status || 500).json({
      error: e.response?.data?.detail || e.message || "Internal server error",
    });
  }
}
