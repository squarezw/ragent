import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

/**
 * GET /api/v1/workflow-runs/:id
 *
 * Thin proxy that forwards the client's Bearer token to ragent-service.
 * Returns the JSON shape from /api/v1/workflow-runs/{id} (see api-contract.md).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { id } = req.query;
  if (!id || Array.isArray(id)) {
    return res.status(400).json({ detail: "id is required" });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization as string;
  }

  try {
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/workflow-runs/${id}`, {
      headers,
      timeout: 15000,
    });
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Upstream error" });
    }
    console.error("[workflow-runs detail] proxy error:", error?.message || error);
    return res.status(502).json({ detail: "Bad gateway" });
  }
}
