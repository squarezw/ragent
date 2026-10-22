import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getTokenFromRequest, requireAuth } from "@/lib/auth";

const baseUrl = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!requireAuth(req, res)) return;
  const id = req.query.fileId;
  if (
    typeof id !== "string" ||
    !/^[1-9]\d*$/.test(id) ||
    !Number.isSafeInteger(Number(id)) ||
    Number(id) > 2147483647
  ) {
    return res.status(400).json({ error: "invalid_file_id" });
  }
  try {
    const response = await axios.request({
      method: req.method,
      url: `${baseUrl}/api/v1/files/${id}/office-preview`,
      headers: { Authorization: `Bearer ${getTokenFromRequest(req)}` },
      data: req.method === "POST" ? { retry: req.body?.retry === true } : undefined,
      timeout: 15000,
      validateStatus: () => true,
    });
    return res.status(response.status).json(response.data);
  } catch {
    return res.status(502).json({ error: "office_preview_unavailable" });
  }
}
