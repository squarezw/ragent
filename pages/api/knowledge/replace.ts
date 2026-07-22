import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { logError } from "@/lib/logError";
import { getUserIdFromRequest } from "@/lib/auth";
import { ossClient } from "@/lib/ossClient";
import pool from "@/lib/db";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { objectKey, fileId, originalFilename, contentType, size } = req.body;

  if (!objectKey || !fileId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const headers: Record<string, string> = {};
  if (req.headers.authorization) {
    headers["Authorization"] = req.headers.authorization;
  }

  try {
    // Get signed download URL for the uploaded file
    const { url: downloadUrl } = await ossClient.sign({ objectKey, expiresIn: 3600 });

    // Call Python backend's replace endpoint
    const response = await axios.post(
      `${EXTERNAL_API_BASE_URL}/api/v1/files/replace`,
      {
        file_id: fileId,
        download_url: downloadUrl,
        object_key: objectKey,
        original_filename: originalFilename,
        content_type: contentType,
        size: size || 0,
      },
      {
        headers: { ...headers, "Content-Type": "application/json" },
        timeout: 300000,
      }
    );

    if (!response.data.success) {
      return res.status(500).json({
        error: response.data.error || response.data.message || "Replace failed",
      });
    }

    // Update object_key in knowledge_files
    try {
      await pool.query("UPDATE knowledge_files SET object_key = $1 WHERE id = $2", [
        objectKey,
        fileId,
      ]);
    } catch (updateErr) {
      console.error("[Replace] Failed to update object_key:", updateErr);
    }

    return res.status(200).json({
      success: true,
      file: {
        id: response.data.file_id,
        filename: response.data.filename,
        originalname: response.data.originalname,
        path: response.data.path,
        status: response.data.status || "pending",
      },
      message: response.data.message,
    });
  } catch (error: any) {
    logError(error);

    if (error.response) {
      return res.status(error.response.status || 500).json({
        error:
          error.response.data?.detail ||
          error.response.data?.error ||
          error.response.data?.message ||
          "Replace failed",
      });
    } else if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") {
      return res.status(503).json({ error: "Cannot connect to file service" });
    } else if (error.code === "ETIMEDOUT") {
      return res.status(504).json({ error: "Replace timeout, file may be too large" });
    }
    return res.status(500).json({ error: error.message || "Replace failed" });
  }
}
