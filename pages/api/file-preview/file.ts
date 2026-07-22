import axios from "axios";
import jwt from "jsonwebtoken";
import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";

const PREVIEW_TOKEN_SECRET = process.env.PREVIEW_TOKEN_SECRET || process.env.JWT_SECRET;

interface PreviewTokenPayload {
  fileUrl: string;
  userId: number;
  sourceAuthHeader?: string;
  timestamp?: number;
  fileId?: string;
}

// MIME 类型映射表
const mimeMap: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
  ".rar": "application/x-rar-compressed",
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
};

// 从 URL 中提取文件扩展名并推断 Content-Type
function getContentTypeFromUrl(url: string, fallbackContentType?: string): string {
  try {
    const urlPath = new URL(url).pathname;
    const ext = path.extname(urlPath).toLowerCase();
    if (ext && mimeMap[ext]) {
      return mimeMap[ext];
    }
  } catch {
    // 如果 URL 解析失败，尝试直接从路径提取
    const ext = path.extname(url).toLowerCase();
    if (ext && mimeMap[ext]) {
      return mimeMap[ext];
    }
  }
  return fallbackContentType || "application/octet-stream";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  if (!PREVIEW_TOKEN_SECRET) {
    res.status(500).json({ error: "PREVIEW_TOKEN_SECRET not configured" });
    return;
  }

  const { token } = req.query;

  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "token is required" });
    return;
  }

  let payload: PreviewTokenPayload;
  try {
    payload = jwt.verify(token, PREVIEW_TOKEN_SECRET) as PreviewTokenPayload;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[file-preview] Token 验证失败:", errorMessage);
    res.status(401).json({ error: "invalid or expired token" });
    return;
  }

  const { fileUrl, sourceAuthHeader, timestamp, fileId } = payload;

  if (!fileUrl) {
    res.status(400).json({ error: "fileUrl missing in token" });
    return;
  }

  // 从请求 URL 中提取扩展名（如果路径包含扩展名，如 /api/file-preview/file.doc）
  // 这样 kkFileView 可以通过 URL 识别文件类型
  let pathExtension = "";
  if (req.url) {
    const urlPath = req.url.split("?")[0]; // 移除查询参数
    const ext = path.extname(urlPath).toLowerCase();
    if (ext && mimeMap[ext]) {
      pathExtension = ext;
    }
  }

  try {
    let targetUrl = fileUrl;

    // 处理相对路径：解析为绝对 URL（kkFileView 从外部容器回调时需要绝对 URL）
    if (targetUrl.startsWith("/")) {
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
      targetUrl = `${protocol}://${host}${targetUrl}`;
    }

    if (targetUrl.includes("localhost:3001") || targetUrl.includes("127.0.0.1:3001")) {
      targetUrl = targetUrl.replace(":3001", ":3000");
    }

    const response = await axios.get(targetUrl, {
      responseType: "stream",
      headers: sourceAuthHeader
        ? {
            Authorization: sourceAuthHeader,
          }
        : undefined,
      timeout: 30000, // 30秒超时
    });

    // 获取源服务器的 Content-Type
    let contentType = response.headers["content-type"] as string | undefined;

    // 优先使用路径中的扩展名（如果存在），因为这是 kkFileView 识别文件类型的主要方式
    if (pathExtension && mimeMap[pathExtension]) {
      contentType = mimeMap[pathExtension];
    }
    // 如果路径中没有扩展名，从文件 URL 推断
    else if (
      !contentType ||
      contentType === "application/octet-stream" ||
      contentType === "text/plain" ||
      contentType.includes("charset")
    ) {
      contentType = getContentTypeFromUrl(fileUrl, contentType);
    }

    // 设置 Content-Type，确保 kkFileView 能正确识别文件类型
    res.setHeader("Content-Type", contentType);

    // 透传 Content-Disposition（如果存在）
    const contentDisposition = response.headers["content-disposition"];
    if (contentDisposition) {
      res.setHeader("Content-Disposition", contentDisposition as string);
    } else {
      // 如果没有 Content-Disposition，设置 inline 以便预览
      res.setHeader("Content-Disposition", "inline");
    }

    // 设置 CORS 头，允许 kkFileView 访问
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    const error = err as {
      message?: string;
      code?: string;
      response?: {
        status?: number;
        data?: unknown;
      };
    };

    console.error("[file-preview] 代理失败:", {
      error: error.message || String(err),
      fileUrl,
      fileId,
      timestamp,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
    });

    if (error.response?.status) {
      res.status(error.response.status).json({
        error: "源文件访问失败",
        details: error.message || "未知错误",
      });
    } else if (error.code === "ECONNREFUSED") {
      res.status(502).json({
        error: "无法连接到文件服务器",
        details: error.message || "连接被拒绝",
      });
    } else {
      res.status(502).json({
        error: "文件预览代理失败",
        details: error.message || "未知错误",
      });
    }
  }
}
