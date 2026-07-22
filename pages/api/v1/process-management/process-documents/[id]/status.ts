import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ detail: "Unauthorized" });
  }

  if (req.method !== "PUT") {
    res.setHeader("Allow", ["PUT"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { id } = req.query;

  try {
    const response = await axios.put(
      `${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${id}/status`,
      req.body,
      { headers: { "Content-Type": "application/json" } }
    );
    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error(`process-document [${id}] status error:`, error);
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}
