import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import axios from "axios";
import pool from "@/lib/db";
import { getUserIdFromRequest, getTokenFromRequest } from "@/lib/auth";
import { getMimeTypeFromExtension, shouldInlineDisplay } from "@/lib/mimeTypes";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { filename, file_id } = req.query;

  if (Array.isArray(filename) || Array.isArray(file_id)) {
    return res.status(400).end("Bad request: invalid parameters");
  }

  if (!file_id) {
    return res.status(400).end("Bad request: file_id is required");
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    // 浏览器直接打开(如企业微信里点参考文件链接)无登录态 → 跳登录页，登录后跳回本链接
    const returnUrl = encodeURIComponent(req.url || "/");
    return res.redirect(302, `/?redirect=${returnUrl}`);
  }

  const fileId = parseInt(file_id, 10);
  if (isNaN(fileId)) {
    return res.status(400).end("Bad request: invalid file_id");
  }

  let fileMimetype: string | null = null;
  let actualFilename: string | null = filename || null;

  try {
    const client = await pool.connect();
    try {
      const fileResult = await client.query(
        "SELECT filename, mimetype FROM knowledge_files WHERE id = $1",
        [fileId]
      );

      if (fileResult.rows.length === 0) {
        return res.status(404).json({ error: "File not found" });
      }

      const fileRecord = fileResult.rows[0];
      fileMimetype = fileRecord.mimetype;
      actualFilename = fileRecord.filename;
    } finally {
      client.release();
    }
  } catch (dbError: any) {
    return res.status(500).json({ error: "Database query failed" });
  }

  try {
    // token 可能来自 Authorization 头(网页 axios)或 cookie(浏览器直开)，统一拼成 Bearer 转发后端
    const token = getTokenFromRequest(req);
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/files/${fileId}/download`, {
      headers,
      responseType: "stream",
      timeout: 300000,
    });

    const ext = path.extname(actualFilename || filename || "").toLowerCase();
    const lowerFilename = (actualFilename || filename || "").toLowerCase();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    let contentType =
      fileMimetype || response.headers["content-type"] || getMimeTypeFromExtension(ext);

    if (
      contentType &&
      !contentType.includes("text") &&
      !contentType.includes("json") &&
      !contentType.includes("xml")
    ) {
      contentType = contentType.split(";")[0].trim();
    }

    if (ext === ".pdf" && contentType !== "application/pdf") {
      contentType = "application/pdf";
    }

    res.setHeader("Content-Type", contentType);

    const contentDisposition = response.headers["content-disposition"];
    if (contentDisposition) {
      res.setHeader("Content-Disposition", contentDisposition);
    } else if (shouldInlineDisplay(ext, lowerFilename, contentType)) {
      res.setHeader("Content-Disposition", "inline");
    }

    res.setHeader("Cache-Control", "public, max-age=3600");

    response.data.on("error", (error: Error) => {
      console.error("[File Download] Stream error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "File stream error" });
      }
    });

    response.data.pipe(res);
  } catch (error: any) {
    console.error(
      "[File Download] Error:",
      error?.message,
      error?.response?.status,
      error?.response?.data
    );
    if (error.response?.status === 404) {
      return res.status(404).json({ error: "File not found" });
    }
    const detail =
      error?.response?.data?.detail ||
      error?.response?.data?.error ||
      error?.message ||
      "Unknown error";
    const status = error?.response?.status || 500;
    return res.status(status).json({ error: "File download failed", detail });
  }
}
