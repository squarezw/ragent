import { requireAuth, getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "GET") return res.status(405).end();

  const user_id = getUserIdFromRequest(req);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 3, 1), 100);
  const result = await pool.query(
    `SELECT id, summary, updated_at FROM chat_session
     WHERE user_id = $1 AND summary IS NOT NULL AND summary <> ''
     ORDER BY updated_at DESC
     LIMIT $2`,
    [user_id, limit]
  );
  res.json({ history: result.rows });
}
