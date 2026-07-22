import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8000";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/statistics`, {
      timeout: 10000,
    });

    if (response.data.status === "success") {
      res.status(200).json(response.data);
    } else {
      res.status(500).json({ error: "Failed to fetch statistics" });
    }
  } catch (error: any) {
    console.error("Error fetching statistics from Python backend:", error.message);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
}
