import type { NextApiRequest, NextApiResponse } from "next";
import { asStr, proxyObserveGet } from "@/lib/observe-proxy";

// GET /api/v1/observe/orders — 工单列表（全部任务，分页, zd-service §5.4.2）
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { q, activeOnly, terminalOnly, state, page, pageSize } = req.query;
  return proxyObserveGet(req, res, "/orders", {
    q: asStr(q),
    activeOnly: asStr(activeOnly),
    terminalOnly: asStr(terminalOnly),
    state: asStr(state),
    page: asStr(page),
    pageSize: asStr(pageSize),
  });
}
