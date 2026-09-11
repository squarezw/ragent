import { requireAuth } from "@/lib/auth";
import type { NextApiRequest, NextApiResponse } from "next";

const MAX_HTML_BYTES = 25 * 1024 * 1024;
const COS_HOST_SUFFIX = ".cos.ap-shanghai.myqcloud.com";

function isAllowedArtifactUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const hostAllowed = url.hostname.endsWith(COS_HOST_SUFFIX);
    const pathAllowed = url.pathname.startsWith("/skill-artifacts/");
    const signed = Boolean(url.searchParams.get("X-Amz-Signature"));
    const html = url.pathname.toLowerCase().endsWith(".html");
    if (url.protocol !== "https:" || url.username || url.password || url.port || !hostAllowed || !pathAllowed || !signed || !html) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Also isolate active HTML when this endpoint is opened directly in a tab.
  res.setHeader("Content-Security-Policy", "sandbox allow-scripts; frame-ancestors 'self'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!requireAuth(req, res)) return;

  const raw = req.query.url;
  if (typeof raw !== "string") return res.status(400).json({ error: "url is required" });

  const target = isAllowedArtifactUrl(raw);
  if (!target) return res.status(400).json({ error: "unsupported artifact URL" });

  try {
    const upstream = await fetch(target, {
      headers: { Accept: "text/html" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "artifact preview unavailable" });
    }

    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > MAX_HTML_BYTES) {
      await upstream.body?.cancel();
      return res.status(413).json({ error: "artifact preview is too large" });
    }

    const reader = upstream.body?.getReader();
    if (!reader) return res.status(502).json({ error: "empty artifact response" });
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_HTML_BYTES) {
        await reader.cancel();
        return res.status(413).json({ error: "artifact preview is too large" });
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(body);
  } catch {
    return res.status(502).json({ error: "artifact preview failed" });
  }
}
