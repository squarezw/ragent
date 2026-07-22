import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const rawSearch = typeof req.query.search === "string" ? req.query.search.trim() : "";
  // Escape ILIKE wildcards so users searching literal "%" or "_" don't accidentally match everything.
  const search = rawSearch.length > 0 ? rawSearch.replace(/[\\%_]/g, (ch) => `\\${ch}`) : null;

  const rawLimit = parseInt((req.query.limit as string) || "", 10);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const client = await pool.connect();
  try {
    // Fetch one extra row to detect truncation
    const result = await client.query(
      `
      SELECT kf.id,
             kf.filename,
             kf.originalname,
             kf.mimetype,
             kf.size,
             kf.upload_time,
             kf.status,
             kf.object_key,
             kf.dataset_id,
             d.name AS dataset_name
      FROM knowledge_files kf
      JOIN datasets d ON d.id = kf.dataset_id
      WHERE can_access_dataset($1, kf.dataset_id)
        AND kf.status <> 'deleted'
        AND ($2::text IS NULL
             OR kf.originalname ILIKE '%' || $2 || '%' ESCAPE '\\'
             OR kf.filename ILIKE '%' || $2 || '%' ESCAPE '\\')
      ORDER BY kf.upload_time DESC NULLS LAST, kf.id DESC
      LIMIT $3
      `,
      [userId, search, limit + 1]
    );

    const truncated = result.rows.length > limit;
    const files = truncated ? result.rows.slice(0, limit) : result.rows;

    return res.status(200).json({ files, truncated });
  } finally {
    client.release();
  }
}
