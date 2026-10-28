import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";
import { isSuperAdmin } from "@/lib/permissions";
import { PENDING_TENANT_SQL } from "@/lib/pendingTenant";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!(await isSuperAdmin(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users u WHERE ${PENDING_TENANT_SQL}`
    );
    return res.status(200).json({ count: result.rows[0].count });
  } catch (error) {
    console.error("Pending tenant count failed:", error);
    return res.status(500).json({ error: "Unable to load pending tenant count" });
  }
}
