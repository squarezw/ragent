import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL;

// GET /api/preference - 获取用户偏好设置
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return handleGet(req, res);
  } else if (req.method === "PUT") {
    return handlePut(req, res);
  } else if (req.method === "DELETE") {
    return handleDelete(req, res);
  } else {
    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    return res.status(405).json({ message: "Method not allowed" });
  }
}

// 获取用户偏好设置
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!EXTERNAL_API_BASE_URL) {
      return res.status(500).json({ message: "External API base URL not configured" });
    }

    // 从请求头中获取 Authorization token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header required" });
    }

    // 调用 Python 后端接口
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/preference/`, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error("Error fetching user preferences:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        message: error.response.data?.message || "Failed to fetch user preferences",
      });
    }

    return res.status(500).json({ message: "Internal server error" });
  }
}

// 更新用户偏好设置
async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!EXTERNAL_API_BASE_URL) {
      return res.status(500).json({ message: "External API base URL not configured" });
    }

    const { llm_model } = req.body;

    if (!llm_model) {
      return res.status(400).json({ message: "llm_model is required" });
    }

    // 从请求头中获取 Authorization token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header required" });
    }

    // 构建请求数据
    const requestData: any = {
      llm_model: llm_model,
    };

    // 调用 Python 后端接口
    const response = await axios.put(`${EXTERNAL_API_BASE_URL}/api/v1/preference/`, requestData, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error("Error updating user preferences:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        message: error.response.data?.message || "Failed to update user preferences",
      });
    }

    return res.status(500).json({ message: "Internal server error" });
  }
}

// 删除用户偏好设置
async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!EXTERNAL_API_BASE_URL) {
      return res.status(500).json({ message: "External API base URL not configured" });
    }

    // 从请求头中获取 Authorization token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header required" });
    }

    // 调用 Python 后端接口
    await axios.delete(`${EXTERNAL_API_BASE_URL}/api/v1/preference/`, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json({ message: "User preferences deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting user preferences:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        message: error.response.data?.message || "Failed to delete user preferences",
      });
    }

    return res.status(500).json({ message: "Internal server error" });
  }
}
