import pool from "@/lib/db";

/**
 * Resolve user_id strings (as stored in zn process_documents.created_by) to display names.
 * Returns a Map keyed by the original string id; missing/invalid ids are simply absent.
 * One SQL roundtrip regardless of input size — never N+1.
 */
export async function buildCreatorNameMap(ids: string[]): Promise<Map<string, string>> {
  const numericIds = Array.from(
    new Set(ids.map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n)))
  );
  if (numericIds.length === 0) return new Map();
  const { rows } = await pool.query<{ id: number; nickname: string | null; username: string | null }>(
    "SELECT id, nickname, username FROM users WHERE id = ANY($1::int[])",
    [numericIds]
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    const name = row.nickname?.trim() || row.username?.trim();
    if (name) map.set(String(row.id), name);
  }
  return map;
}

export async function resolveCreatorName(id: string | null | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  const map = await buildCreatorNameMap([id]);
  return map.get(id);
}
