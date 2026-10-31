-- Persist external job attribution at creation. No legacy actor-based backfill.
BEGIN;
CREATE TABLE IF NOT EXISTS external_workspace_resources (
  kind text NOT NULL,
  external_id text NOT NULL,
  operation_tenant_id integer NOT NULL REFERENCES tenant(id),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, external_id)
);
CREATE INDEX IF NOT EXISTS external_workspace_resources_tenant_idx
  ON external_workspace_resources(operation_tenant_id,kind);
COMMIT;
