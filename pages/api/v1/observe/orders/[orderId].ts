import type { NextApiRequest, NextApiResponse } from "next";
import { asStr, proxyObserveGet } from "@/lib/observe-proxy";

// GET /api/v1/observe/orders/:orderId — 单工单全貌 + 流程轴 (zd-service §5.4.3)
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const orderId = asStr(req.query.orderId);
  return proxyObserveGet(req, res, `/orders/${encodeURIComponent(orderId ?? "")}`);
}
