import axios from "axios";
import { workspacePreviewSource } from "@/lib/workspacePreviewSource";
import { getUserIdFromRequest, getTokenFromRequest, requireAuth } from "@/lib/auth";
import pool from "@/lib/db";
import { ossClient } from "@/lib/ossClient";
import jwt from "jsonwebtoken";
import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";

const PREVIEW_TOKEN_SECRET = process.env.PREVIEW_TOKEN_SECRET || process.env.JWT_SECRET;

const PREVIEW_TOKEN_TTL_SECONDS = 30 * 60; // 30 分钟有效期（kkFileView 需要时间处理）

interface PreviewTokenPayload {
  fileUrl: string;
  operationTenantId?: number;
  userId: number;
  sourceAuthHeader?: string;
  // 添加时间戳和文件标识，确保每次生成的 URL 都是唯一的
  timestamp: number;
  fileId?: string;
}

// 从 URL 中提取文件扩展名
function getFileExtension(url: string): string {
  try {
    const urlPath = new URL(url).pathname;
    const ext = path.extname(urlPath).toLowerCase();
    return ext || "";
  } catch {
    // 如果 URL 解析失败，尝试直接从路径提取
    const ext = path.extname(url).toLowerCase();
    return ext || "";
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  if (!PREVIEW_TOKEN_SECRET) {
    res.status(500).json({ error: "PREVIEW_TOKEN_SECRET not configured" });
    return;
  }

  if (!requireAuth(req, res)) {
    return;
  }

  let { fileUrl, fileId, extension } = req.body as {
    fileUrl?: string;
    fileId?: string;
    extension?: string;
  };

  if (!fileUrl || typeof fileUrl !== "string") {
    res.status(400).json({ error: "fileUrl is required" });
    return;
  }

  const appBaseUrl = process.env.FILE_PREVIEW_BASE_URL;
  const kkBaseUrl = process.env.KKFILEVIEW_BASE_URL;

  if (!appBaseUrl || !kkBaseUrl) {
    res.status(500).json({ error: "Preview service not configured" });
    return;
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    res.status(401).json({ error: "未登录" });
    return;
  }

  let operationTenantId: number | undefined;
  if (process.env.WORKSPACE_TENANT_ENABLED === "true") {
    const { requireWorkspaceTenant } = await import("@/lib/workspaceTenant");
    const { workspaceCanReadObject } = await import("@/lib/workspaceFiles");
    const ctx = await requireWorkspaceTenant(req, res);
    if (!ctx) return;
    operationTenantId = ctx.tenantId!;
    if (fileId) {
      const file = await pool.query(`SELECT f.id, f.filename FROM knowledge_files f JOIN datasets d ON d.id=f.dataset_id WHERE f.id::text=$1 AND (d.owner_tenant_id=$2 OR d.visibility='public') AND (can_access_dataset($3,d.id) OR d.visibility='public')`, [String(fileId), ctx.tenantId, ctx.actorUserId]);
      if (!file.rows.length) return res.status(404).json({ error: "WORKSPACE_RESOURCE_NOT_FOUND" });
      // Bind fallback delivery to the authorized file, never a caller-supplied URL.
      fileUrl = `/api/uploads/${encodeURIComponent(file.rows[0].filename || "file")}?file_id=${encodeURIComponent(String(fileId))}`;
    } else {
      const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
      const source = workspacePreviewSource(fileUrl, [origin, new URL(appBaseUrl).origin]);
      if (!source) return res.status(404).json({ error: "WORKSPACE_RESOURCE_NOT_FOUND" });
      fileUrl = source;
      if (source.startsWith("/api/oss/")) {
        const local = new URL(source, "https://workspace.invalid");
        if (!await workspaceCanReadObject(ctx, decodeURIComponent(local.pathname.slice("/api/oss/".length))))
          return res.status(404).json({ error: "WORKSPACE_RESOURCE_NOT_FOUND" });
      } else {
        // Probe the exact resource endpoint so published/draft and process ancestry
        // rules apply before issuing a preview capability. Never follow redirects.
        try {
          const response = await axios.get(new URL(source, appBaseUrl).href, {
            headers: { Authorization: `Bearer ${getTokenFromRequest(req)}`, "X-Workspace-Tenant-ID": String(operationTenantId) },
            responseType: "stream", maxRedirects: 0, timeout: 15000,
          });
          response.data.destroy();
        } catch {
          return res.status(404).json({ error: "WORKSPACE_RESOURCE_NOT_FOUND" });
        }
      }
    }
  }

  // 如果传了 fileId，尝试查 DB 获取 object_key，直接用 OSS 签名 URL
  if (fileId) {
    try {
      const client = await pool.connect();
      try {
        const result = await client.query("SELECT object_key FROM knowledge_files WHERE id = $1", [
          fileId,
        ]);
        if (result.rows[0]?.object_key) {
          // 有 object_key → OSS 签名 URL 直接给 kkfileview，跳过代理链
          const { url: ossUrl } = await ossClient.sign({
            objectKey: result.rows[0].object_key,
            expiresIn: PREVIEW_TOKEN_TTL_SECONDS,
          });
          const fileExtension = getFileExtension(fileUrl);
          // kkfileview 需要 URL 中包含文件扩展名来识别文件类型
          // OSS URL 通常已包含扩展名，但如果没有，需要添加后缀参数
          let finalUrl = ossUrl;
          if (fileExtension && !ossUrl.includes(fileExtension)) {
            // 添加 fullfilename 参数让 kkfileview 识别文件类型
            const separator = ossUrl.includes("?") ? "&" : "?";
            finalUrl = `${ossUrl}${separator}fullfilename=file${fileExtension}`;
          }
          const encodedUrl = Buffer.from(finalUrl).toString("base64");
          const previewUrl = `${kkBaseUrl}/onlinePreview?url=${encodeURIComponent(encodedUrl)}`;
          res.status(200).json({ previewUrl });
          return;
        }
      } finally {
        client.release();
      }
    } catch (err) {
      // 查询失败，降级走代理流程
      console.error("[create-link] DB query failed, falling back to proxy:", err);
    }
  }

  // 无 object_key 或未传 fileId → 保持现有 JWT token 代理流程
  const sourceAuthHeader = getTokenFromRequest(req) ? `Bearer ${getTokenFromRequest(req)}` : undefined;

  // 添加时间戳确保 token 唯一性，避免 kkFileView 缓存问题
  const timestamp = Date.now();

  const token = jwt.sign(
    {
      fileUrl,
      operationTenantId,
      userId,
      sourceAuthHeader,
      timestamp,
      fileId,
    } as PreviewTokenPayload,
    PREVIEW_TOKEN_SECRET,
    {
      expiresIn: PREVIEW_TOKEN_TTL_SECONDS,
    }
  );

  // 从原始文件 URL 中提取文件扩展名，添加到代理 URL 中
  // 这样 kkFileView 可以通过 URL 识别文件类型
  // 如果调用方显式传了 extension（如 ".docx"），优先使用
  const fileExtension = extension || getFileExtension(fileUrl);

  // 生成唯一的文件标识符，放入路径中（而不是查询参数）
  // 这样 kkFileView 会认为是不同的文件，避免缓存问题
  // 格式：file-{timestamp}-{random}.{ext}
  const uniqueId = `${timestamp}-${Math.random().toString(36).substring(2, 9)}`;

  // 将唯一 ID 放到文件名中，确保路径唯一
  // 例如：/api/file-preview/file-1234567890-abc123.docx?token=xxx
  const fileDownloadUrl = fileExtension
    ? `${appBaseUrl}/api/file-preview/file-${uniqueId}${fileExtension}?token=${encodeURIComponent(token)}`
    : `${appBaseUrl}/api/file-preview/file-${uniqueId}?token=${encodeURIComponent(token)}`;

  const encodedUrl = Buffer.from(fileDownloadUrl).toString("base64");

  // kkFileView 的 URL（不需要额外的查询参数，因为路径已经是唯一的了）
  const previewUrl = `${kkBaseUrl}/onlinePreview?url=${encodeURIComponent(encodedUrl)}`;

  res.status(200).json({ previewUrl });
}
