import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { createVersion, downloadCurrent, getLatestVersion } from "@/lib/documentFileVersions";
import { getMimeTypeFromFilename } from "@/lib/mimeTypes";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";
const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const config = {
  api: { bodyParser: false },
};

/**
 * GET  → Serve document file (from OSS, fallback to handbook session or KB file)
 * PUT  → Save new version to OSS (OnlyOffice callback)
 * POST ?from_session=xxx      → Copy handbook DOCX to OSS as v1
 * POST ?from_knowledge_file=x → Copy KB file to OSS as v1
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);

  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method === "PUT") return handlePut(req, res, String(userId));
  if (req.method === "POST") {
    if (req.query.from_knowledge_file) return handleCopyFromKnowledge(req, res, String(userId));
    return handleCopyFromSession(req, res, String(userId));
  }

  res.setHeader("Allow", ["GET", "PUT", "POST"]);
  return res.status(405).json({ detail: "Method not allowed" });
}

/** Download remote file, persist to OSS in background, serve buffer to client. */
function serveAndPersist(
  res: NextApiResponse,
  docId: string,
  buffer: Buffer,
  filename: string,
) {
  createVersion(docId, buffer).catch((err) =>
    console.error(`Failed to persist doc ${docId} to OSS:`, err instanceof Error ? err.message : err)
  );

  const contentType = getMimeTypeFromFilename(filename);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const docId = req.query.id as string;

  // 1. Try OSS — stream directly to avoid CORS issues with blob downloads.
  // 用 downloadCurrent 而非 downloadLatest：编辑期的修改（含新插入的图片）只写入 draft，取 latest 会拿到旧版本导致图片丢失。
  const buffer = await downloadCurrent(docId);
  if (buffer) {
    res.setHeader("Content-Type", DOCX_CONTENT_TYPE);
    res.setHeader("Content-Disposition", `attachment; filename="${docId}.docx"`);
    return res.send(buffer);
  }

  let filePath = "";
  let docName = "";
  try {
    const docResp = await axios.get(`${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${docId}`);
    const doc = docResp.data?.data ?? docResp.data;
    filePath = doc?.file_path || "";
    docName = doc?.name || "";
  } catch {
    // Continue with empty metadata
  }

  // Derive a download filename from the doc name or fall back to docId.docx
  const filename = docName || `${docId}.docx`;

  // 2. Fallback: fetch from handbook session
  try {
    const match = filePath.match(/handbook_([a-f0-9]+)\.docx$/);
    if (match) {
      const sessionId = match[1];
      const handbookResp = await axios.get(
        `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/download/${sessionId}`,
        { responseType: "arraybuffer", timeout: 120000 }
      );
      return serveAndPersist(res, docId, Buffer.from(handbookResp.data), filename);
    }
  } catch {
    // Fall through
  }

  // 3. Fallback: fetch from knowledge-base file reference (kb_file_{id})
  try {
    const kbMatch = filePath.match(/^kb_file_(.+)$/);
    if (kbMatch) {
      const kbResp = await axios.get(
        `${EXTERNAL_API_BASE_URL}/api/v1/files/${kbMatch[1]}/download`,
        { headers: authHeaders(req), responseType: "arraybuffer", timeout: 120000 }
      );
      return serveAndPersist(res, docId, Buffer.from(kbResp.data), filename);
    }
  } catch {
    // Fall through
  }

  return res.status(404).json({ detail: "Document file not found" });
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const docId = req.query.id as string;

  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const buffer = Buffer.concat(chunks);
      const result = await createVersion(docId, buffer, userId);
      console.log(
        `process-document saved to OSS: ${docId} v${result.version} (${buffer.length} bytes)`
      );
      return res.status(200).json({
        ok: true,
        version: result.version,
        objectKey: result.objectKey,
      });
    } catch (err: any) {
      console.error("process-document file upload error:", err?.message);
      return res.status(500).json({ detail: "Upload failed" });
    }
  });
  req.on("error", (err) => {
    console.error("process-document file stream error:", err);
    return res.status(500).json({ detail: "Upload failed" });
  });
}

async function handleCopyFile(
  req: NextApiRequest,
  res: NextApiResponse,
  userId: string,
  sourceUrl: string,
  label: string,
  headers?: Record<string, string>
) {
  const docId = req.query.id as string;

  try {
    const existing = await getLatestVersion(docId);
    if (existing) {
      return res.status(200).json({ ok: true, version: existing.version, skipped: true });
    }

    const response = await axios.get(sourceUrl, {
      headers,
      responseType: "arraybuffer",
      timeout: 120000,
    });
    const buffer = Buffer.from(response.data);
    const result = await createVersion(docId, buffer, userId);

    console.log(
      `process-document copied from ${label} to OSS: ${docId} v${result.version} (${buffer.length} bytes)`
    );
    return res.status(200).json({ ok: true, version: result.version, size: buffer.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`copy-file error (${label}): doc=${docId}`, msg);
    return res.status(500).json({ detail: `Failed to copy file from ${label}` });
  }
}

function authHeaders(req: NextApiRequest): Record<string, string> {
  const h: Record<string, string> = {};
  if (req.headers.authorization) h["Authorization"] = req.headers.authorization;
  return h;
}

async function handleCopyFromKnowledge(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const kbFileId = req.query.from_knowledge_file as string;
  if (!kbFileId) {
    return res.status(400).json({ detail: "from_knowledge_file is required" });
  }
  return handleCopyFile(
    req, res, userId,
    `${EXTERNAL_API_BASE_URL}/api/v1/files/${kbFileId}/download`,
    `knowledge file ${kbFileId}`,
    authHeaders(req)
  );
}

async function handleCopyFromSession(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const sessionId = req.query.from_session as string;
  if (!sessionId) {
    return res.status(400).json({ detail: "from_session is required" });
  }
  return handleCopyFile(
    req, res, userId,
    `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/download/${sessionId}`,
    `session ${sessionId}`
  );
}
