import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

/**
 * GET /api/v1/conversations/:cid/active-workflow-runs
 *
 * Returns non-terminal workflow runs for the given chat_session. Called by
 * useTaskAttach when a conversation is opened/loaded so unfinished tasks
 * resume their progress card.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { cid } = req.query;
  if (!cid || Array.isArray(cid)) {
    return res.status(400).json({ detail: "cid is required" });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization as string;
  }

  try {
    const response = await axios.get(
      `${EXTERNAL_API_BASE_URL}/api/v1/conversations/${cid}/active-workflow-runs`,
      { headers, timeout: 15000 }
    );
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Upstream error" });
    }
    console.error("[active-workflow-runs] proxy error:", error?.message || error);
    return res.status(502).json({ detail: "Bad gateway" });
  }
}
