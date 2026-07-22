import type { NextApiRequest, NextApiResponse } from "next";
import { getLatestVersion } from "@/lib/documentFileVersions";

/**
 * GET /api/v1/process-management/process-documents/:id/latest-version
 *
 * Lightweight endpoint that returns only the latest version number.
 * Used by the frontend to poll for save completion after force-save.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const docId = req.query.id as string;
  const version = await getLatestVersion(docId);

  return res.status(200).json({ version: version?.version ?? null });
}
