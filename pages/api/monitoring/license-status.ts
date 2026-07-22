import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

/**
 * Proxy to ragent-service /api/v1/license/status (admin-only endpoint).
 * Forwards the caller's Authorization header. Backend verifies super-admin role.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/license/status`, {
      headers: {
        accept: "application/json",
        Authorization: req.headers.authorization,
      },
      timeout: 5000,
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 400) {
      return res.status(response.status).json({
        status: "error",
        error: response.data?.detail || "License status unavailable",
      });
    }

    return res.status(200).json(response.data);
  } catch (error) {
    console.error("Failed to fetch license status:", error);
    return res.status(200).json({ status: "error" });
  }
}
