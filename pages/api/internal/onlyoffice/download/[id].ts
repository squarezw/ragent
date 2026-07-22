import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";
import { downloadCurrent } from "@/lib/documentFileVersions";
import { requireEnv } from "@/lib/env";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";
const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";
const SECRET = requireEnv("ONLYOFFICE_JWT_SECRET");

/**
 * GET /api/internal/onlyoffice/download/:id?token=xxx&expires=xxx
 *
 * Supplies DOCX file to OnlyOffice Document Server.
 * Uses HMAC-signed token (no user auth — called by OnlyOffice server).
 *
 * Supports two document sources:
 *  - session:<sessionId>  → handbook DOCX from process-mgmt backend
 *  - doc:<docId>          → process-document file from process-mgmt backend
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id, token, expires } = req.query;
  const docKey = id as string;
  const exp = parseInt(expires as string, 10);

  if (!token || !expires || isNaN(exp)) {
    return res.status(403).json({ error: "Invalid token" });
  }
  if (Date.now() > exp) {
    return res.status(403).json({ error: "Token expired" });
  }

  const expected = crypto.createHmac("sha256", SECRET).update(`${docKey}:${expires}`).digest("hex");
  if (token !== expected) {
    return res.status(403).json({ error: "Invalid token" });
  }

  try {
    if (docKey.startsWith("session:")) {
      const sessionId = docKey.slice("session:".length);
      const response = await axios.get(
        `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/download/${sessionId}`,
        { responseType: "stream", timeout: 300000 }
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      response.data.pipe(res);
      return;
    }

    if (docKey.startsWith("doc:")) {
      const docId = docKey.slice("doc:".length);

      // Try OSS (draft first, then latest version)
      const buffer = await downloadCurrent(docId);
      if (buffer) {
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        return res.send(buffer);
      }

      // Fallback: fetch from handbook session via file proxy
      const docResp = await axios.get(`${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${docId}`);
      const doc = docResp.data?.data ?? docResp.data;
      const filePath: string = doc?.file_path || "";
      const match = filePath.match(/handbook_([a-f0-9]+)\.docx$/);
      if (match) {
        const response = await axios.get(
          `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/download/${match[1]}`,
          { responseType: "stream", timeout: 300000 }
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        response.data.pipe(res);
        return;
      }

      // Fallback: fetch from knowledge-base file reference (kb_file_{id})
      const kbMatch = filePath.match(/^kb_file_(.+)$/);
      if (kbMatch) {
        const kbResp = await axios.get(
          `${EXTERNAL_API_BASE_URL}/api/v1/files/${kbMatch[1]}/download`,
          { responseType: "stream", timeout: 300000 }
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        kbResp.data.pipe(res);
        return;
      }

      return res.status(404).json({ error: "Document file not found" });
    }

    return res.status(400).json({ error: "Invalid document key format" });
  } catch (error: any) {
    console.error("onlyoffice download error:", error?.message);
    const status = error?.response?.status || 500;
    return res.status(status).json({ error: "Download failed" });
  }
}

/**
 * Generate a signed download URL for OnlyOffice to fetch a document.
 */
export function generateOnlyOfficeDownloadUrl(
  baseUrl: string,
  docKey: string,
  ttlMs = 3600_000
): string {
  const expires = Date.now() + ttlMs;
  const token = crypto.createHmac("sha256", SECRET).update(`${docKey}:${expires}`).digest("hex");
  return `${baseUrl}/api/internal/onlyoffice/download/${encodeURIComponent(docKey)}?token=${token}&expires=${expires}`;
}
