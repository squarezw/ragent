import type { NextApiRequest, NextApiResponse } from "next";
import { asStr, proxyObserveGet } from "@/lib/observe-proxy";

// GET /api/v1/observe/orders/:orderId/logs — 节点日志（点节点时拉, zd-service §5.4.4）
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const orderId = asStr(req.query.orderId);
  const { phase, level, after, limit } = req.query;
  return proxyObserveGet(req, res, `/orders/${encodeURIComponent(orderId ?? "")}/logs`, {
    phase: asStr(phase),
    level: asStr(level),
    after: asStr(after),
    limit: asStr(limit),
  });
}
