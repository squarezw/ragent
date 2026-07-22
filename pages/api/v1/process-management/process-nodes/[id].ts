import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ detail: "Unauthorized" });
  }

  const { id } = req.query;
  const url = `${PROCESS_MGMT_BASE_URL}/api/v1/process-nodes/${id}`;

  try {
    if (req.method === "GET") {
      const response = await axios.get(url);
      return res.status(200).json(response.data);
    }

    if (req.method === "PUT") {
      const response = await axios.put(url, req.body, {
        headers: { "Content-Type": "application/json" },
      });
      return res.status(200).json(response.data);
    }

    if (req.method === "DELETE") {
      const response = await axios.delete(url);
      return res.status(response.status).json(response.data);
    }

    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    return res.status(405).json({ detail: "Method not allowed" });
  } catch (error: any) {
    console.error(`process-node [${id}] error:`, error);
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}
