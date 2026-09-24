import { Readable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { ossClient } from "@/lib/ossClient";

// Categories that were previously served from public/ and don't require auth
const PUBLIC_CATEGORIES = ["system"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const keyParts = req.query.key;
  if (!keyParts || !Array.isArray(keyParts) || keyParts.length === 0) {
    return res.status(400).json({ error: "Missing object key" });
  }

  const objectKey = keyParts.join("/");
  const category = keyParts[0];

  if (!PUBLIC_CATEGORIES.includes(category)) {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    // 签名 URL 上的 Content-Disposition 是 attachment。预览 iframe 跟着 302
    // 会触发下载，所以 inline=1 时由我们把字节流回去并改成 inline。
    if (req.query.inline === "1") {
      const { url } = await ossClient.sign({ objectKey, expiresIn: 600 });
      const upstream = await fetch(url);
      if (!upstream.ok || !upstream.body) {
        return res.status(502).json({ error: "Failed to fetch file" });
      }
      const contentType = (upstream.headers.get("content-type") || "application/octet-stream")
        .split(";")[0]
        .trim();
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "private, max-age=600");
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    }

    const { url } = await ossClient.sign({ objectKey });
    return res.redirect(302, url);
  } catch (error: any) {
    console.error("[OSS Download] Error:", {
      message: error.message,
      code: error.code || error.cause?.code,
      cause: error.cause?.message,
    });
    return res.status(500).json({ error: error.message || "Failed to generate download URL" });
  }
}
