import type { NextApiRequest, NextApiResponse } from "next";
import { getTokenFromRequest, getUserIdFromRequest } from "@/lib/auth";

// Keep the browser endpoint compatible; upload authorization lives in ragent-service.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  const token = getTokenFromRequest(req);
  if (!userId || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { filename, contentType, category } = req.body || {};
  if (!filename || !contentType || !category) {
    return res.status(400).json({
      error: "Missing required fields: filename, contentType, category",
    });
  }

  const apiBase = (process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010").replace(/\/$/, "");
  try {
    const response = await fetch(`${apiBase}/api/v1/files/presign`, {
      method: "POST",
      headers: {
        ...(process.env.WORKSPACE_TENANT_ENABLED === "true" && typeof req.headers["x-workspace-tenant-id"] === "string" ? { "X-Workspace-Tenant-ID": String(req.headers["x-workspace-tenant-id"]) } : {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filename, contentType, category }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = typeof result.detail === "string"
        ? result.detail
        : "Upload authorization failed";
      return res.status(response.status).json({ error });
    }
    return res.status(200).json(result);
  } catch {
    return res.status(502).json({ error: "Upload authorization service unavailable" });
  }
}
