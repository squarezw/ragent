import { getUserIdFromRequest, requireAuth } from "@/lib/auth";
import pool from "@/lib/db";
import { createPreviewLink, previewRevision } from "@/lib/previewLinkPolicy";
import type { NextApiRequest, NextApiResponse } from "next";

const PREVIEW_TOKEN_SECRET = process.env.PREVIEW_TOKEN_SECRET || process.env.JWT_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
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
      `SELECT object_key, mimetype, size, upload_time, filename
       FROM knowledge_files
       WHERE id = $1 AND can_access_dataset($2, dataset_id) AND status <> 'deleted'`,
      [fileId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "File not found" });
    }

    const file = result.rows[0];
    const metadata = {
      fileId,
      objectKey: file.object_key || undefined,
      mimetype: file.mimetype || "application/octet-stream",
      size: file.size,
      uploadTime: file.upload_time,
      filename: file.filename,
    };

    // Revalidate authentication, dataset access and current file metadata on every open.
    // Stable URLs let the browser reuse its private response cache without extending token TTL.
    const link = createPreviewLink(
      { ...metadata, userId, revision: previewRevision(metadata) },
      req.body?.previousToken,
      PREVIEW_TOKEN_SECRET
    );
    return res.status(200).json(link);
  } finally {
    client.release();
  }
}
