import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { ossClient } from "@/lib/ossClient";

// Categories that were previously served from public/ and don't require auth
const PUBLIC_CATEGORIES = ["sop-images", "system"];

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
