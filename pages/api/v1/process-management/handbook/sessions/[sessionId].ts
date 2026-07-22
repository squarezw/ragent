import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  const { sessionId } = req.query;

  if (req.method === "DELETE") {
    try {
      // Cancel running/queued task first (ignore errors — session may already be completed)
      await axios
        .post(`${PROCESS_MGMT_BASE_URL}/api/v1/handbook/analyze/${sessionId}/cancel`)
        .catch((err) => console.warn(`Cancel session ${sessionId} before delete failed:`, err.message));

      const response = await axios.delete(
        `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/sessions/${sessionId}`,
      );
      return res.status(200).json(response.data);
    } catch (error: any) {
      if (error.response) {
        return res
          .status(error.response.status)
          .json(error.response.data || { detail: "Request failed" });
      }
      return res.status(500).json({ detail: "Internal server error" });
    }
  }

  res.setHeader("Allow", ["DELETE"]);
  return res.status(405).json({ detail: "Method not allowed" });
}
