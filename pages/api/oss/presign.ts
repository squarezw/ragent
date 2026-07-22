import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { ossClient } from "@/lib/ossClient";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { filename, contentType, category } = req.body;

  if (!filename || !contentType || !category) {
    return res.status(400).json({
      error: "Missing required fields: filename, contentType, category",
    });
  }

  try {
    const result = await ossClient.presign({ filename, contentType, category });
    return res.status(200).json(result);
  } catch (error: any) {
    console.error("[OSS Presign] Error:", {
      message: error.message,
      code: error.code || error.cause?.code,
      cause: error.cause?.message,
    });
    return res.status(500).json({ error: error.message || "Presign failed" });
  }
}
