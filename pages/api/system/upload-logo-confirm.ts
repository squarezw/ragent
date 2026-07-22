import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const isSuper = await isSuperAdmin(userId);
    if (!isSuper) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { objectKey } = req.body;

    if (!objectKey) {
      return res.status(400).json({ error: "Missing objectKey" });
    }

    return res.status(200).json({ url: `/api/oss/${objectKey}` });
  } catch (error: any) {
    console.error("[Logo Confirm] Error:", error);
    return res.status(500).json({ error: error.message || "Confirm failed" });
  }
}
