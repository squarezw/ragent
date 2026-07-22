import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { getUserIdFromRequest } from "@/lib/auth";
import { convertDocxToPdf } from "@/lib/docxToPdf";
import { stripDocxExtension } from "@/lib/mimeTypes";
import { requireEnv } from "@/lib/env";

const ONLYOFFICE_SECRET = requireEnv("ONLYOFFICE_JWT_SECRET");
const INTERNAL_BASE_URL = process.env.FILE_PREVIEW_BASE_URL || "http://web:3000";

/**
 * POST /api/internal/docx/convert
 * Body: { type: "doc"|"session", id: string, outputType?: "pdf", filename?: string }
 *
 * Converts a process document or handbook session DOCX to PDF via OnlyOffice (layout fidelity),
 * then post-processes heading bookmarks into the PDF (OnlyOffice itself emits none, see
 * lib/docxToPdf.ts). Returns the file as a binary download.
 *
 * 注：源文件读取仍走 /api/internal/onlyoffice/download（OnlyOffice 在线编辑器也用），
 *     故这里继续复用 ONLYOFFICE_JWT_SECRET 签名下载令牌。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "POST") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { type, id, outputType = "pdf", filename } = req.body;
  if (!type || !id) {
    return res.status(400).json({ detail: "type and id are required" });
  }
  if (outputType !== "pdf") {
    return res.status(400).json({ detail: "only pdf output is supported" });
  }

  const docKey = type === "session" ? `session:${id}` : `doc:${id}`;
  const downloadUrl = generateSignedDownloadUrl(docKey);

  const baseName = filename ? stripDocxExtension(filename) : String(id);

  try {
    const pdfBuffer = await convertDocxToPdf({ sourceUrl: downloadUrl });

    const dlName = `${baseName}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(dlName)}"`);
    return res.send(pdfBuffer);
  } catch (error: any) {
    console.error("docx→pdf conversion error:", error?.message);
    return res.status(502).json({ detail: "Conversion failed" });
  }
}

function generateSignedDownloadUrl(docKey: string, ttlMs = 3600_000): string {
  const expires = Date.now() + ttlMs;
  const token = crypto
    .createHmac("sha256", ONLYOFFICE_SECRET)
    .update(`${docKey}:${expires}`)
    .digest("hex");
  return `${INTERNAL_BASE_URL}/api/internal/onlyoffice/download/${encodeURIComponent(docKey)}?token=${token}&expires=${expires}`;
}
