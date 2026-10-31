import { getTokenFromRequest } from "@/lib/auth";
import axios, { type AxiosResponse } from "axios";
import jwt from "jsonwebtoken";
import type { NextApiRequest, NextApiResponse } from "next";
import { ossClient } from "@/lib/ossClient";

const PREVIEW_TOKEN_SECRET = process.env.PREVIEW_TOKEN_SECRET || process.env.JWT_SECRET;
const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

interface StreamTokenPayload {
  fileId: string;
  operationTenantId?: number;
  userId: number;
  mimetype: string;
  objectKey?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!PREVIEW_TOKEN_SECRET) {
    return res.status(500).json({ error: "PREVIEW_TOKEN_SECRET not configured" });
  }

  const { token } = req.query;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "token is required" });
  }

  let payload: StreamTokenPayload;
  try {
    payload = jwt.verify(token, PREVIEW_TOKEN_SECRET) as StreamTokenPayload;
  } catch {
    return res.status(401).json({ error: "invalid or expired token" });
  }

  let backendHeaders: Record<string,string> = {};
  if (process.env.WORKSPACE_TENANT_ENABLED === "true") {
    const { requireWorkspaceTenant } = await import("@/lib/workspaceTenant");
    const { workspaceCanReadObject } = await import("@/lib/workspaceFiles");
    const ctx = await requireWorkspaceTenant(req, res);
    if (!ctx) return;
    const pool = (await import("@/lib/db")).default;
    const file = await pool.query(`SELECT f.id FROM knowledge_files f JOIN datasets d ON d.id=f.dataset_id WHERE f.id::text=$1 AND (d.owner_tenant_id=$2 OR d.visibility='public') AND (can_access_dataset($3,d.id) OR d.visibility='public')`, [payload.fileId,ctx.tenantId,ctx.actorUserId]);
    if (!file.rows.length) return res.status(404).json({ error: "WORKSPACE_RESOURCE_NOT_FOUND" });
    if (payload.operationTenantId !== ctx.tenantId || payload.userId !== ctx.actorUserId ||
        (payload.objectKey && !await workspaceCanReadObject(ctx, payload.objectKey)))
      return res.status(404).json({ error: "WORKSPACE_RESOURCE_NOT_FOUND" });
    const actorToken = getTokenFromRequest(req);
    if (!actorToken) return res.status(401).json({error:"Unauthorized"});
    backendHeaders = {Authorization:`Bearer ${actorToken}`,"X-Workspace-Tenant-ID":String(ctx.tenantId)};
  }
  const { fileId, mimetype, objectKey } = payload;

  if (!fileId) {
    return res.status(400).json({ error: "fileId missing in token" });
  }

  try {
    let response: AxiosResponse;

    if (objectKey) {
      // 有 object_key → 从 OSS 获取，签名 URL 有效期短，按需生成
      const { url: ossUrl } = await ossClient.sign({
        objectKey,
        expiresIn: 600,
      });
      response = await axios.get(ossUrl, {
        responseType: "stream",
        timeout: 300000,
      });
    } else {
      // 无 object_key（旧文件）→ 从 Python 后端获取
      response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/files/${fileId}/download`, {
        headers: backendHeaders,
        responseType: "stream",
        timeout: 300000,
      });
    }

    // 由代理控制 header，确保浏览器内联显示
    res.setHeader("Content-Type", mimetype || "application/octet-stream");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", process.env.WORKSPACE_TENANT_ENABLED === "true" ? "private, no-store" : "private, max-age=1800");

    response.data.pipe(res);
  } catch (err) {
    const error = err as {
      message?: string;
      response?: { status?: number };
    };

    console.error("[file-preview/stream] 代理失败:", {
      error: error.message || String(err),
      fileId,
      objectKey: !!objectKey,
    });

    if (error.response?.status === 404) {
      return res.status(404).json({ error: "File not found" });
    }

    return res.status(502).json({
      error: "文件预览代理失败",
      details: error.message || "未知错误",
    });
  }
}
