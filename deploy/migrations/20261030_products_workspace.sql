-- Apply only as part of the reviewed tenant-workspace migration. Never run at application startup.
-- Legacy rows have no reliable ownership source. NULL rows are quarantined while the
-- feature is enabled; an operator must approve an explicit id -> tenant mapping.
BEGIN;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS owner_tenant_id integer REFERENCES public.tenant(id);
CREATE INDEX IF NOT EXISTS products_owner_tenant_idx ON public.products(owner_tenant_id);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sn_unique;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_sn_unique ON public.products(owner_tenant_id, sn) WHERE owner_tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_legacy_sn_unique ON public.products(sn) WHERE owner_tenant_id IS NULL;
COMMIT;
-- Rollback: disable the feature first. Before restoring UNIQUE(sn), explicitly
-- resolve duplicate SNs across tenants; never drop or merge customer records.
-- Do not drop owner_tenant_id, since that destroys audited ownership snapshots.
