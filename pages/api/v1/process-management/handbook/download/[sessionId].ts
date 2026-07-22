import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { sessionId } = req.query;

  try {
    const response = await axios.get(
      `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/download/${sessionId}`,
      { responseType: "arraybuffer" }
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    // Forward upstream filename if available, fallback to session-based name
    const upstreamDisposition = response.headers["content-disposition"] as string | undefined;
    const filenameMatch = upstreamDisposition?.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
    const filename = filenameMatch ? decodeURIComponent(filenameMatch[1].replace(/"/g, "")) : `handbook-${sessionId}.docx`;
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    return res.status(200).send(Buffer.from(response.data));
  } catch (error: any) {
    if (error.response) {
      return res.status(error.response.status).json({ detail: "Download failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}
