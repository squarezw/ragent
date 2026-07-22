import axios from "@/lib/axios";
import type { AxiosRequestConfig } from "axios";
import type {
  Envelope,
  LogLevel,
  ObserveLogsData,
  ObserveOrderDetailData,
  ObserveOrderListData,
  ObserveSummaryData,
  OrderState,
} from "./types";

// lib/axios 拦截器约定的自定义配置：置 true 时跳过全局错误 toast，调用方自行做友好提示
type ObserveRequestConfig = AxiosRequestConfig & { suppressErrorToast?: boolean };

/**
 * 全部经 ragent BFF（pages/api/v1/observe/*），相对路径 + JWT（lib/axios 自动带）。
 * BFF 回 zd-service 的 { code, message, data } 外壳，这里统一解出 data。
 */

const BASE = "/api/v1/observe";

async function getData<T>(
  url: string,
  params?: Record<string, unknown>,
  opts?: { suppressErrorToast?: boolean }
): Promise<T> {
  const config: ObserveRequestConfig = { params, suppressErrorToast: opts?.suppressErrorToast };
  const res = await axios.get<Envelope<T>>(url, config);
  return res.data.data;
}

export function fetchSummary(): Promise<ObserveSummaryData> {
  return getData<ObserveSummaryData>(`${BASE}/summary`);
}

export function fetchActiveOrders(
  page: number,
  q: string,
  pageSize = 5
): Promise<ObserveOrderListData> {
  return getData<ObserveOrderListData>(`${BASE}/orders`, {
    activeOnly: "true",
    page,
    pageSize,
    q: q || undefined,
  });
}

export function fetchTerminalOrders(
  page: number,
  q: string,
  pageSize = 20
): Promise<ObserveOrderListData> {
  return getData<ObserveOrderListData>(`${BASE}/orders`, {
    terminalOnly: "true",
    page,
    pageSize,
    q: q || undefined,
  });
}

export function fetchOrderDetail(
  orderId: string,
  opts?: { suppressErrorToast?: boolean }
): Promise<ObserveOrderDetailData> {
  return getData<ObserveOrderDetailData>(
    `${BASE}/orders/${encodeURIComponent(orderId)}`,
    undefined,
    opts
  );
}

export function fetchOrderLogs(
  orderId: string,
  opts: { phase?: OrderState; level?: LogLevel; after?: number; limit?: number } = {}
): Promise<ObserveLogsData> {
  return getData<ObserveLogsData>(`${BASE}/orders/${encodeURIComponent(orderId)}/logs`, {
    phase: opts.phase,
    level: opts.level,
    after: opts.after,
    limit: opts.limit,
  });
}
