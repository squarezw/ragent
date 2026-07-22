import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";
import { getLatestVersion } from "@/lib/documentFileVersions";
import { requireEnv } from "@/lib/env";

const ONLYOFFICE_SECRET = requireEnv("ONLYOFFICE_JWT_SECRET");
const ONLYOFFICE_URL = process.env.ONLYOFFICE_URL || "http://localhost:8443";

// URL OnlyOffice server uses to reach Next.js (Docker internal)
const INTERNAL_BASE_URL =
  process.env.FILE_PREVIEW_BASE_URL || "http://web:3000";

/**
 * GET /api/internal/onlyoffice/config/:id?type=session|doc
 *
 * Returns a signed OnlyOffice editor configuration.
 * The id is either a session ID or a document ID depending on `type`.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "GET") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { id, type = "doc" } = req.query;
  const docType = type as string;
  const docId = id as string;

  // Build the document key for OnlyOffice.
  // - doc:     `doc_<id>_v<N>_<ts>`  — N 是打开编辑器时的 latest version，
  //                                    让 OnlyOffice 延迟 save 跟提交后新产生的版本隔离
  // - session: `session_<id>_<ts>`   — handbook session 无版本概念
  let versionSeg = "";
  if (docType === "doc") {
    const latest = await getLatestVersion(docId);
    versionSeg = `v${latest?.version ?? 0}_`;
  }
  const docKey = `${docType}_${docId}_${versionSeg}${Date.now()}`;

  // Build the download URL that OnlyOffice will fetch the file from
  const downloadDocKey =
    docType === "session" ? `session:${docId}` : `doc:${docId}`;
  const downloadUrl = generateSignedDownloadUrl(
    INTERNAL_BASE_URL,
    downloadDocKey,
  );

  // Build the callback URL for OnlyOffice to notify saves
  const callbackUrl = `${INTERNAL_BASE_URL}/api/internal/onlyoffice/callback`;

  // Get document title
  let title = "document.docx";
  if (docType === "doc") {
    try {
      const result = await pool.query(
        "SELECT name FROM process_documents WHERE id = $1",
        [docId],
      );
      if (result.rows[0]?.name) {
        title = result.rows[0].name;
        if (!title.endsWith(".docx")) title += ".docx";
      }
    } catch {
      // Fall through with default title
    }
  }

  // Get user info
  let userName = "User";
  try {
    const result = await pool.query(
      "SELECT name, username FROM users WHERE id = $1",
      [userId],
    );
    if (result.rows[0]) {
      userName = result.rows[0].name || result.rows[0].username;
    }
  } catch {
    // Fall through with default name
  }

  const config = {
    document: {
      fileType: "docx",
      key: docKey,
      title,
      url: downloadUrl,
    },
    documentType: "word",
    editorConfig: {
      callbackUrl,
      lang: "zh-CN",
      mode: "edit",
      user: {
        id: String(userId),
        name: userName,
      },
      customization: {
        // autosave 必须开：OnlyOffice 的 forcesave 是"立即触发一次 autosave"，关掉 autosave 会让保存按钮一并失效。
        autosave: true,
        forcesave: true,
        chat: false,
        comments: false,
        compactHeader: true,
        spellcheck: false,
        plugins: false,
        zoom: 150,
      },
    },
  };

  // Sign the config with OnlyOffice JWT
  const token = jwt.sign(config, ONLYOFFICE_SECRET, { algorithm: "HS256" });
  const signedConfig = { ...config, token, onlyofficeUrl: ONLYOFFICE_URL };

  return res.status(200).json(signedConfig);
}

function generateSignedDownloadUrl(
  baseUrl: string,
  docKey: string,
  ttlMs = 3600_000,
): string {
  const secret = ONLYOFFICE_SECRET;
  const expires = Date.now() + ttlMs;
  const token = crypto
    .createHmac("sha256", secret)
    .update(`${docKey}:${expires}`)
    .digest("hex");
  return `${baseUrl}/api/internal/onlyoffice/download/${encodeURIComponent(docKey)}?token=${token}&expires=${expires}`;
}
