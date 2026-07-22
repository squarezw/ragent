import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const externalApiBaseUrl = process.env.EXTERNAL_API_BASE_URL;

    if (!externalApiBaseUrl) {
      return res.status(500).json({
        message: "EXTERNAL_API_BASE_URL not configured",
      });
    }

    // 调用外部Python服务的系统状态接口
    const response = await fetch(`${externalApiBaseUrl}/api/v1/system/status`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      // 设置超时时间
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`External API responded with status: ${response.status}`);
    }

    const data = await response.json();

    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching system status:", error);

    // 返回默认的系统状态数据，避免前端显示错误
    return res.status(200).json({
      status: "success",
      data: {
        cpu: {
          usage_percent: 0,
        },
        memory: {
          total: 0,
          used: 0,
          available: 0,
          percent: 0,
        },
        gpu: null,
      },
      message: "系统状态获取失败，使用默认数据",
    });
  }
}
