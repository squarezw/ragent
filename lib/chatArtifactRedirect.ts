import type { NextApiRequest, NextApiResponse } from "next";
import { getTokenFromRequest } from "@/lib/auth";
import { requireWorkspaceTenant } from "@/lib/workspaceTenant";
import { parseChatArtifactUrl } from "@/lib/chatResourcePreview";

/** Resolve a canonical session resource with the current actor. Never forward credentials to storage. */
export async function resolveChatArtifact(req: NextApiRequest, res: NextApiResponse, raw: string) {
  const artifact = parseChatArtifactUrl(raw);
  if (!artifact) {
    res.status(400).end();
    return null;
  }
  const workspace = await requireWorkspaceTenant(req, res);
  if (!workspace) return null;
  const token = getTokenFromRequest(req);
  if (!token) {
    res.status(401).end();
    return null;
  }
  try {
    const endpoint = new URL(artifact.path.replace("/api/chat/", "/api/v1/chat/"), process.env.EXTERNAL_API_BASE_URL);
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}`, "X-Workspace-Tenant-ID": String(workspace.tenantId) },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    await response.body?.cancel();
    if (response.status !== 307) {
      res.status(response.status >= 400 && response.status < 500 ? response.status : 502).end();
      return null;
    }
    const location = response.headers.get("location");
    if (location) {
      const target = new URL(location);
      if (["https:", "http:"].includes(target.protocol) && !target.username && !target.password) return target;
    }
  } catch {
    // The upstream response and URL can contain temporary storage credentials.
  }
  res.status(502).end();
  return null;
}
