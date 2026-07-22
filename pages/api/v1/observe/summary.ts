import type { NextApiRequest, NextApiResponse } from "next";
import { proxyObserveGet } from "@/lib/observe-proxy";

// GET /api/v1/observe/summary — 车队统计卡 (zd-service §5.4.1)
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxyObserveGet(req, res, "/summary");
}
