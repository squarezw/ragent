import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

/**
 * 流程观测看板 BFF：浏览器永不直连 zd-service，所有读请求经此代理。
 * 浏览器侧用 ragent JWT 鉴权（任意登录用户可访问，PRD §8 不设角色门槛）；
 * 服务端持有的 ZD_OBSERVE_TOKEN 绝不下发浏览器，只在这里拼进出站请求。
 */
const ZD_SERVICE_BASE_URL = process.env.ZD_SERVICE_BASE_URL;
const ZD_OBSERVE_TOKEN = process.env.ZD_OBSERVE_TOKEN;

/**
 * 把一个 GET 请求透传到 zd-service 的 /api/v1/observe{path}。
 * zd-service 统一外壳 { code, message, data }，HTTP status = code，原样回传。
 */
export async function proxyObserveGet(
  req: NextApiRequest,
  res: NextApiResponse,
  path: string,
  params?: Record<string, string | undefined>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ code: 405, message: "Method not allowed", data: null });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ code: 401, message: "未登录", data: null });
  }

  // 缺配置直接抛，不静默 fallback（对齐项目「早暴露错误」纪律）。
  if (!ZD_SERVICE_BASE_URL || !ZD_OBSERVE_TOKEN) {
    throw new Error("ZD_SERVICE_BASE_URL / ZD_OBSERVE_TOKEN 未配置");
  }

  try {
    const response = await axios.get(`${ZD_SERVICE_BASE_URL}/api/v1/observe${path}`, {
      headers: { Authorization: `Bearer ${ZD_OBSERVE_TOKEN}` },
      params,
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      // 401/403 是「服务端持有的 ZD_OBSERVE_TOKEN 被 zd-service 拒了」——属于部署配置问题，
      // 绝不能原样透传给浏览器：前端共用的 lib/axios 见到 401 会无条件清登录态、踢用户重登。
      // 一个后端 token 故障会在 30s 轮询里反复把正常登录的用户登出。统一压成 502（后端不可用）。
      if (status === 401 || status === 403) {
        console.error(
          `[observe-proxy] zd-service 拒绝服务端 token (${status})，请检查 ZD_OBSERVE_TOKEN`
        );
        return res.status(502).json({ code: 502, message: "观测后端鉴权失败", data: null });
      }
      // 其余业务错误（400/404…）原样回传 zd-service 的外壳。
      return res.status(status).json(error.response.data);
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[observe-proxy] zd-service 不可达:", msg);
    return res.status(502).json({ code: 502, message: "观测后端不可达", data: null });
  }
}

/** Next.js query 参数可能是 string | string[]，统一取首个值。 */
export function asStr(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
