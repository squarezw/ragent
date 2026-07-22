import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method, query } = req;
  const { id, app_id, start_date, end_date } = query;

  try {
    const token = req.cookies.ragent_token;
    const apiKey = req.headers["x-api-key"];

    const headers: any = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    } else if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    switch (method) {
      case "GET": {
        // 获取工具统计数据
        const params = new URLSearchParams();
        if (app_id) params.append("app_id", app_id as string);
        if (start_date) params.append("start_date", start_date as string);
        if (end_date) params.append("end_date", end_date as string);

        const response = await axios.get(
          `${BACKEND_URL}/api/v1/tools/${id}/statistics${params.toString() ? `?${params.toString()}` : ""}`,
          { headers }
        );

        return res.status(200).json(response.data);
      }

      default:
        res.setHeader("Allow", ["GET"]);
        return res.status(405).json({ error: `Method ${method} Not Allowed` });
    }
  } catch (error: any) {
    console.error("Tool Statistics API error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: error.response?.data?.detail || error.message || "Internal server error",
    });
  }
}
