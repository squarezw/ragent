import { requireAuth } from "@/lib/auth";
import axios from "axios";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { markdown, filename } = req.body;

  if (!markdown || typeof markdown !== "string") {
    return res.status(400).json({ error: "Markdown content is required" });
  }

  try {
    const pdfServiceUrl = process.env.PDF_SERVICE_URL;
    const microserviceUrl = `${pdfServiceUrl}/api/markdown-to-pdf`;

    console.log(`[PDF Proxy] Connecting to: ${microserviceUrl}`);

    const response = await axios.post(
      microserviceUrl,
      {
        markdown,
        filename,
      },
      {
        responseType: "stream",
        timeout: 60000, // 60s timeout for PDF generation
      }
    );

    // 转发响应头
    if (response.headers["content-type"]) {
      res.setHeader("Content-Type", response.headers["content-type"]);
    }
    if (response.headers["content-disposition"]) {
      res.setHeader("Content-Disposition", response.headers["content-disposition"]);
    }
    if (response.headers["content-length"]) {
      res.setHeader("Content-Length", response.headers["content-length"]);
    }

    // 管道转发数据
    response.data.pipe(res);
  } catch (error: unknown) {
    // biome-ignore lint/suspicious/noExplicitAny: Axios error handling is complex
    const err = error as any;
    console.error("[PDF Proxy] Error Message:", err.message);
    if (err.code) console.error("[PDF Proxy] Error Code:", err.code);
    if (err.config) console.error("[PDF Proxy] Request URL:", err.config.url);

    if (err.response) {
      // 服务端响应错误
      // 如果是流式响应，尝试读取错误信息
      try {
        // 对于 stream 类型，error.response.data 是一个 stream
        // 我们不能简单地把它转成 json，除非我们读取它
        // 这里简单起见，返回状态码
        res.status(err.response.status).json({
          error: "PDF generation service failed",
          status: err.response.status,
        });
      } catch {
        res.status(err.response.status).end();
      }
    } else if (err.request) {
      // 无响应
      console.error("[PDF Proxy] No response received");
      res.status(503).json({ error: "PDF service unavailable" });
    } else {
      // 设置请求时出错
      res.status(500).json({ error: "Internal proxy error" });
    }
  }
}
