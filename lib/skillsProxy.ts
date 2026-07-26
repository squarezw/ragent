import type { NextApiRequest, NextApiResponse } from "next";
import axios, { type Method } from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

/**
 * Skills / Agent.md 端点的纯透传代理（BFF）。
 * 鉴权与出错形状对齐 pages/api/apps/[id]/tools 系列：
 * - 浏览器 JWT 经 Authorization 透传给 Python 后端（或 X-API-Key）；
 * - 后端业务错误（409 引用冲突、422 校验失败等）连 body 原样回传，前端要读 detail。
 */
const BACKEND_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export interface SkillsProxyOptions {
  /** 后端路径（不含 query），如 `/api/v1/skills/${id}` */
  path: string;
  /** 允许的 HTTP 方法 */
  allow: Method[];
  /** 需要透传的 query 参数名白名单（req.query 里还混着动态路由段，不能整体转发） */
  passQuery?: string[];
  /** 期望纯文本响应（如 export 的 SKILL.md / Agent.md） */
  text?: boolean;
  /**
   * 放开 axios 的 body 体积上限（资产上传单文件 20MB，base64 后约 27MB）。
   * 路由侧还要各自配 `api.bodyParser.sizeLimit`，Next 默认 1mb 会先一步 413。
   */
  largeBody?: boolean;
}

export async function proxySkillsApi(
  req: NextApiRequest,
  res: NextApiResponse,
  options: SkillsProxyOptions
) {
  const method = (req.method || "GET").toUpperCase() as Method;
  if (!options.allow.includes(method)) {
    res.setHeader("Allow", options.allow);
    return res.status(405).json({ detail: `Method ${method} Not Allowed` });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ detail: "Unauthorized" });
  }

  const authHeader = req.headers.authorization;
  const apiKey = req.headers["x-api-key"];
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["X-API-Key"] = Array.isArray(apiKey) ? apiKey[0] : apiKey;
  } else if (authHeader) {
    headers.Authorization = authHeader;
  } else {
    return res.status(401).json({ detail: "Authorization header required" });
  }

  const params = new URLSearchParams();
  for (const key of options.passQuery || []) {
    const value = req.query[key];
    if (value !== undefined) {
      params.append(key, Array.isArray(value) ? value[0] : value);
    }
  }
  const url = `${BACKEND_URL}${options.path}${params.toString() ? `?${params.toString()}` : ""}`;

  try {
    const response = await axios.request({
      url,
      method,
      headers,
      data: method === "GET" || method === "DELETE" ? undefined : req.body,
      responseType: options.text ? "text" : "json",
      // text 模式下禁用 axios 的 JSON 自动解析
      transformResponse: options.text ? [(data) => data] : undefined,
      maxBodyLength: options.largeBody ? Number.POSITIVE_INFINITY : undefined,
      maxContentLength: options.largeBody ? Number.POSITIVE_INFINITY : undefined,
    });

    if (options.text) {
      res.setHeader("Content-Type", response.headers["content-type"] || "text/markdown");
      return res.status(response.status).send(response.data);
    }
    if (response.status === 204) {
      return res.status(204).end();
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      // 409（被引用）/ 422（Agent.md 校验带行号）等业务错误 body 原样回传
      return res.status(error.response.status).json(error.response.data);
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[skills-proxy] backend unreachable: ${method} ${url}:`, msg);
    return res.status(502).json({ detail: "Backend unreachable" });
  }
}

/** Next.js query 参数可能是 string | string[]，统一取首个值。 */
export function queryStr(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] : v || "";
}
