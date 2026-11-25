export interface SessionToolUsage {
  coverage: "complete" | "partial" | "unavailable";
  tools: { name: string; calls: number; failures: number }[];
}

// Return only aggregate counts. A retained start and finish (or a snapshot of
// the same invocation) have one identity within their run.
export const sessionToolUsageQuery = `
  WITH details AS (
    SELECT id, session_id FROM chat_session_detail WHERE session_id = $1
  ), runs AS (
    SELECT r.run_id, r.detail_id, r.projection->'tool_steps' AS steps, r.cursor
    FROM details d JOIN chat_runs r ON r.detail_id = d.id
      AND r.session_id = d.session_id::text AND r.workspace_id = $2
  ), records AS (
    SELECT e.run_id, e.data
    FROM runs r JOIN chat_run_events e USING (run_id) WHERE e.event = 'tool_status'
    UNION ALL
    SELECT r.run_id, step
    FROM runs r CROSS JOIN LATERAL json_array_elements(r.steps) step
  ), calls AS (
    SELECT run_id, data->>'tool_call_id' AS call_id, MAX(data->>'name') AS name,
      BOOL_OR(data->>'phase' = 'finished' AND data->>'ok' = 'false') AS failed
    FROM records
    WHERE NULLIF(data->>'tool_call_id', '') IS NOT NULL AND NULLIF(data->>'name', '') IS NOT NULL
    GROUP BY run_id, data->>'tool_call_id'
  ), totals AS (
    SELECT name, COUNT(*) AS calls, COUNT(*) FILTER (WHERE failed) AS failures
    FROM calls GROUP BY name
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM runs) THEN 'unavailable'
    WHEN EXISTS (SELECT 1 FROM details d WHERE NOT EXISTS (SELECT 1 FROM runs r WHERE r.detail_id = d.id))
      OR EXISTS (SELECT 1 FROM records WHERE NULLIF(data->>'tool_call_id', '') IS NULL
        OR NULLIF(data->>'name', '') IS NULL)
      OR EXISTS (SELECT 1 FROM runs r WHERE r.cursor > 0 AND NOT EXISTS
        (SELECT 1 FROM chat_run_events e WHERE e.run_id = r.run_id AND e.cursor = 1))
      THEN 'partial'
    ELSE 'complete' END AS coverage,
    COALESCE((SELECT json_agg(t ORDER BY calls DESC, name) FROM totals t), '[]'::json) AS tools
`;
