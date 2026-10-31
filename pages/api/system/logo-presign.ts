import type { NextApiRequest, NextApiResponse } from "next";
import { getTokenFromRequest, getUserIdFromRequest } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import pool from "@/lib/db";

/** Global branding is separate from business workspaces. Never forward a browser tenant. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).end();
  const actor = getUserIdFromRequest(req),
    token = getTokenFromRequest(req);
  if (!actor || !token) return res.status(401).json({ error: "Unauthorized" });
  try {
    if (!(await isSuperAdmin(actor))) return res.status(403).json({ error: "Forbidden" });
    const active = await pool.query("SELECT id FROM users WHERE id=$1 AND status='active'", [
      actor,
    ]);
    if (!active.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const { filename, contentType, size } = req.body || {};
    if (
      typeof filename !== "string" ||
      !filename.trim() ||
      filename.length > 255 ||
      typeof contentType !== "string" ||
      !/^image\/[a-z0-9.+-]+$/i.test(contentType) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > 5 * 1024 * 1024
    )
      return res.status(400).json({ error: "Invalid logo upload" });
    const base = (process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010").replace(/\/$/, "");
    const upstream = await fetch(`${base}/api/v1/files/presign`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filename, contentType, category: "system" }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await upstream.json();
    if (!upstream.ok)
      return res.status(upstream.status).json({ error: "Logo upload authorization failed" });
    return res.status(200).json(body);
  } catch {
    return res.status(502).json({ error: "Logo upload authorization unavailable" });
  }
}
