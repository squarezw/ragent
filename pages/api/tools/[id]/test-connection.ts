import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const BACKEND_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

/**
 * 工具连接体检的代理。
 *
 * 单独一个文件而不是挂在 `[id].ts` 的 switch 上：那是工具 CRUD 的入口，
 * 而这是一次**会真的跟 MCP 对端握手**的动作（远程几百毫秒，stdio 类首次解析包
 * 可能几十秒，后端上限 20s）。混在一起时，将来给 CRUD 加超时/重试会顺手把
 * 体检也改掉，而两者的合适值差别很大。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method, query } = req;
  const { id } = query;

  if (method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${method} Not Allowed` });
  }

  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ detail: "Unauthorized" });
    }

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

    // 后端要真的去握手，所以这里不能短于后端的注册超时（20s），否则前端先断，
    // 用户看到的是"超时失败"，而那次体检其实还在跑并会写下结论。
    const response = await axios.post(
      `${BACKEND_URL}/api/v1/tools/${id}/test-connection`,
      {},
      { headers, timeout: 30000 }
    );

    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error("Tool connection test error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: error.response?.data?.detail || error.message || "Internal server error",
    });
  }
}
