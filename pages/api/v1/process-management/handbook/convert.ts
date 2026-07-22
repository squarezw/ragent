import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import mammoth from "mammoth";
import { getUserIdFromRequest } from "@/lib/auth";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { session_id } = req.query;
  if (!session_id || Array.isArray(session_id)) {
    return res.status(400).json({ detail: "session_id is required" });
  }

  try {
    const response = await axios.get(
      `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/download/${session_id}`,
      { responseType: "arraybuffer", timeout: 300000 }
    );

    const buffer = Buffer.from(response.data);
    const result = await mammoth.convertToHtml({ buffer });

    return res.status(200).json({ html: result.value });
  } catch (error: any) {
    console.error("handbook convert error:", error?.message);
    if (error.response) {
      return res.status(error.response.status).json({ detail: "Download or conversion failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}
