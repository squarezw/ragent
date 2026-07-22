import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { syncAppSchedule, unscheduleApp } from "@/lib/cron/subscription-scheduler";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8000";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return handleGet(req, res);
  } else if (req.method === "PUT") {
    return handlePut(req, res);
  } else if (req.method === "DELETE") {
    return handleDelete(req, res);
  } else {
    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }
}

// 获取单个应用
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ detail: "Unauthorized" });
    }

    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ detail: "App ID is required" });
    }

    // 从请求头中获取 Authorization token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ detail: "Authorization header required" });
    }

    // 调用 Python 后端接口
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/apps/${id}`, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error("Error fetching app:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        detail: error.response.data?.detail || "Failed to fetch app",
      });
    }

    return res.status(500).json({ detail: "Internal server error" });
  }
}

// 更新应用
async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ detail: "Unauthorized" });
    }

    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ detail: "App ID is required" });
    }

    // 从请求头中获取 Authorization token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ detail: "Authorization header required" });
    }

    // 调用 Python 后端接口
    const response = await axios.put(`${EXTERNAL_API_BASE_URL}/api/v1/apps/${id}`, req.body, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    // Sync cron task for Subscription apps
    const appData = response.data;
    if (appData.app_type === "Subscription") {
      syncAppSchedule(Number(id), appData.app_type, appData.settings);
    }

    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error("Error updating app:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        detail: error.response.data?.detail || "Failed to update app",
      });
    }

    return res.status(500).json({ detail: "Internal server error" });
  }
}

// 删除应用
async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ detail: "Unauthorized" });
    }

    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ detail: "App ID is required" });
    }

    // 从请求头中获取 Authorization token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ detail: "Authorization header required" });
    }

    // 调用 Python 后端接口
    await axios.delete(`${EXTERNAL_API_BASE_URL}/api/v1/apps/${id}`, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    // Remove cron task if exists
    unscheduleApp(Number(id));

    return res.status(204).end();
  } catch (error: any) {
    console.error("Error deleting app:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        detail: error.response.data?.detail || "Failed to delete app",
      });
    }

    return res.status(500).json({ detail: "Internal server error" });
  }
}
