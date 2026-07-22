import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";
import pool from "@/lib/db";
import path from "path";
import { requireEnv } from "@/lib/env";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";
const SECRET = requireEnv("JWT_SECRET");

/**
 * GET /api/internal/download/:fileId?token=xxx&expires=xxx
 *
 * Unauthenticated file download using HMAC-signed temporary token.
 * Used by backend services (docfuse-agent) to download knowledge files.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { fileId, token, expires } = req.query;
  const fid = fileId as string;
  const exp = parseInt(expires as string, 10);

  // Validate token
  if (!token || !expires || isNaN(exp)) {
    return res.status(403).json({ error: "Invalid token" });
  }

  if (Date.now() > exp) {
    return res.status(403).json({ error: "Token expired" });
  }

  const expected = crypto.createHmac("sha256", SECRET).update(`${fid}:${expires}`).digest("hex");

  if (token !== expected) {
    return res.status(403).json({ error: "Invalid token" });
  }

  // Fetch file from Python backend (no auth needed — we verified the token)
  try {
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/files/${fid}/download`, {
      responseType: "stream",
      timeout: 300000,
    });

    const contentType = response.headers["content-type"] || "application/octet-stream";
    res.setHeader("Content-Type", contentType);

    if (response.headers["content-disposition"]) {
      res.setHeader("Content-Disposition", response.headers["content-disposition"]);
    }

    response.data.pipe(res);
  } catch (error: any) {
    const status = error?.response?.status || 500;
    return res.status(status).json({ error: "Download failed" });
  }
}

/**
 * Generate a signed download URL for a file.
 * Valid for `ttlMs` milliseconds (default 1 hour).
 */
export function generateSignedDownloadUrl(
  baseUrl: string,
  fileId: string | number,
  ttlMs = 3600_000
): string {
  const expires = Date.now() + ttlMs;
  const token = crypto.createHmac("sha256", SECRET).update(`${fileId}:${expires}`).digest("hex");
  return `${baseUrl}/api/internal/download/${fileId}?token=${token}&expires=${expires}`;
}
