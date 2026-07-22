import { getUserIdFromRequest, requireAuth } from "@/lib/auth";
import pool from "@/lib/db";
import jwt from "jsonwebtoken";
import type { NextApiRequest, NextApiResponse } from "next";

const PREVIEW_TOKEN_SECRET = process.env.PREVIEW_TOKEN_SECRET || process.env.JWT_SECRET;

const PREVIEW_URL_TTL_SECONDS = 1800; // 30 分钟

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!PREVIEW_TOKEN_SECRET) {
    return res.status(500).json({ error: "PREVIEW_TOKEN_SECRET not configured" });
  }

  if (!requireAuth(req, res)) {
    return;
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const rawFileId = req.body?.fileId;

  if (!rawFileId) {
    return res.status(400).json({ error: "fileId is required" });
  }

  const fileId = String(rawFileId);

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT object_key, mimetype FROM knowledge_files WHERE id = $1",
      [fileId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "File not found" });
    }

    const { object_key, mimetype } = result.rows[0];

    // 始终通过 stream 代理，由代理控制 Content-Disposition: inline
    // 避免 OSS 签名 URL 的 attachment header 导致浏览器下载
    const token = jwt.sign(
      {
        fileId,
        userId,
        mimetype: mimetype || "application/octet-stream",
        objectKey: object_key || undefined,
      },
      PREVIEW_TOKEN_SECRET,
      { expiresIn: PREVIEW_URL_TTL_SECONDS }
    );

    const url = `/api/file-preview/stream?token=${encodeURIComponent(token)}`;
    return res.status(200).json({ url, expiresIn: PREVIEW_URL_TTL_SECONDS });
  } finally {
    client.release();
  }
}
