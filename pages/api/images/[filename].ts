import axios from "axios";
import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

// MIME type mapping
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

/**
 * Get content type from file extension
 */
function getContentTypeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return mimeMap[ext] || "application/octet-stream";
}

/**
 * Proxy image/file requests to Python backend service
 * Endpoint: GET /api/images/{filename}
 * Proxies to: GET ${EXTERNAL_API_BASE_URL}/api/v1/files/{filename}
 *
 * This endpoint is used to serve images embedded in segment_text markdown.
 * MarkdownRenderer rewrites /public/files/{filename} to /api/images/{filename}
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { filename } = req.query;

  // Validate filename parameter
  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ error: "filename is required" });
  }

  // Construct backend URL
  const backendUrl = `${EXTERNAL_API_BASE_URL}/api/v1/files/${filename}`;

  try {
    // Prepare headers - pass through Authorization if present
    const headers: Record<string, string> = {};
    if (req.headers.authorization) {
      headers.Authorization = req.headers.authorization;
    }

    // Make request to Python backend
    const response = await axios.get(backendUrl, {
      responseType: "stream",
      headers,
      timeout: 300000, // 5 minutes for large files
      validateStatus: (status) => status < 500, // Handle 4xx errors gracefully
    });

    // Handle non-2xx responses
    if (response.status >= 400) {
      return res.status(response.status).json({
        error: "File not found or access denied",
        details: response.data,
      });
    }

    // Get content type from backend response or infer from filename
    const contentType =
      (response.headers["content-type"] as string) || getContentTypeFromFilename(filename);

    // Set response headers
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600"); // Cache for 1 hour

    // Pass through content-disposition if present
    const contentDisposition = response.headers["content-disposition"];
    if (contentDisposition) {
      res.setHeader("Content-Disposition", contentDisposition as string);
    } else {
      // Default to inline for images, attachment for others
      const ext = path.extname(filename).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"].includes(ext);
      res.setHeader(
        "Content-Disposition",
        isImage ? "inline" : `attachment; filename="${filename}"`
      );
    }

    // Pass through content-length if present
    if (response.headers["content-length"]) {
      res.setHeader("Content-Length", response.headers["content-length"]);
    }

    // Pass through etag if present
    if (response.headers.etag) {
      res.setHeader("ETag", response.headers.etag as string);
    }

    // Pass through last-modified if present
    if (response.headers["last-modified"]) {
      res.setHeader("Last-Modified", response.headers["last-modified"] as string);
    }

    // Set CORS headers to allow cross-origin access
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Stream the response
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

    console.error("[images-proxy] Error proxying file request:", {
      filename,
      backendUrl,
      error: error.message || String(err),
      code: error.code,
      responseStatus: error.response?.status,
    });

    // Connection errors
    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      return res.status(502).json({
        error: "Cannot connect to file service",
        details: error.message || "Connection failed",
      });
    }

    // Timeout errors
    if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      return res.status(504).json({
        error: "File request timeout",
        details: error.message || "Request timed out",
      });
    }

    // Backend response errors
    if (error.response?.status) {
      return res.status(error.response.status).json({
        error: "Backend error",
        details: error.response.data || error.message || "Unknown error",
      });
    }

    // Unknown errors
    return res.status(500).json({
      error: "File proxy failed",
      details: error.message || "Unknown error",
    });
  }
}
