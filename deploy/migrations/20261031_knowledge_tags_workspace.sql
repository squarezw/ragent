-- Explicit operator-run data migration; never execute at application startup.
-- Requires tenant_workspace.sql. Back up tags and file-tag links before applying.
BEGIN;
LOCK TABLE public.knowledge_tags, public.knowledge_file_tags IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.datasets, public.knowledge_files, public.tenant IN SHARE MODE;
ALTER TABLE public.knowledge_tags DROP CONSTRAINT IF EXISTS knowledge_tags_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_tags_tenant_name_unique
  ON public.knowledge_tags(owner_tenant_id, name) WHERE owner_tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_tags_legacy_name_unique
  ON public.knowledge_tags(name) WHERE owner_tenant_id IS NULL;
CREATE TABLE IF NOT EXISTS public.workspace_data_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
DO $migration$
DECLARE
  legacy record;
  target integer;
  target_tag integer;
  owners integer[];
  old_count integer := 0;
  copied_count integer := 0;
  assigned_count integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.workspace_data_migrations WHERE version='20261031_knowledge_tags_workspace') THEN
    RETURN;
  END IF;
  -- Missing file/dataset ownership cannot safely be interpreted as an unused preset.
  IF EXISTS (
    SELECT 1 FROM public.knowledge_tags t
    JOIN public.knowledge_file_tags ft ON ft.tag_id=t.id
    LEFT JOIN public.knowledge_files f ON f.id=ft.file_id
    LEFT JOIN public.datasets d ON d.id=f.dataset_id
    WHERE t.owner_tenant_id IS NULL AND d.owner_tenant_id IS NULL
  ) THEN RAISE EXCEPTION 'Unattributed legacy tag use requires explicit repair before migration'; END IF;
  FOR legacy IN SELECT * FROM public.knowledge_tags WHERE owner_tenant_id IS NULL ORDER BY id LOOP
    old_count := old_count + 1;
    SELECT array_agg(DISTINCT d.owner_tenant_id ORDER BY d.owner_tenant_id) INTO owners
      FROM public.knowledge_file_tags ft
      JOIN public.knowledge_files f ON f.id=ft.file_id
      JOIN public.datasets d ON d.id=f.dataset_id
      WHERE ft.tag_id=legacy.id;
    IF owners IS NULL THEN
      -- Unused legacy presets get independent copies for the current active tenants.
      -- The NULL originals stay quarantined. The ledger prevents copying into future tenants.
      SELECT array_agg(id ORDER BY id) INTO owners FROM public.tenant WHERE status='active';
      IF owners IS NULL THEN RAISE EXCEPTION 'No active tenants for legacy tag presets'; END IF;
    ELSIF array_length(owners,1)=1 AND NOT EXISTS (
      SELECT 1 FROM public.knowledge_tags WHERE owner_tenant_id=owners[1] AND name=legacy.name
    ) THEN
      -- Preserve existing IDs and file associations whenever ownership is unambiguous.
      UPDATE public.knowledge_tags SET owner_tenant_id=owners[1], updated_at=CURRENT_TIMESTAMP WHERE id=legacy.id;
      assigned_count := assigned_count + 1;
      CONTINUE;
    END IF;
    FOREACH target IN ARRAY owners LOOP
      INSERT INTO public.knowledge_tags(name,color,created_at,updated_at,owner_tenant_id)
        VALUES(legacy.name,legacy.color,legacy.created_at,CURRENT_TIMESTAMP,target)
        ON CONFLICT(owner_tenant_id,name) WHERE owner_tenant_id IS NOT NULL DO NOTHING;
      IF FOUND THEN copied_count := copied_count + 1; END IF;
      SELECT id INTO STRICT target_tag FROM public.knowledge_tags WHERE owner_tenant_id=target AND name=legacy.name;
      -- Avoid duplicate pairs if a previous manual repair already attached the tenant copy.
      DELETE FROM public.knowledge_file_tags old_link USING public.knowledge_files f, public.datasets d
        WHERE old_link.tag_id=legacy.id AND old_link.file_id=f.id AND f.dataset_id=d.id
          AND d.owner_tenant_id=target AND EXISTS (
            SELECT 1 FROM public.knowledge_file_tags new_link WHERE new_link.file_id=f.id AND new_link.tag_id=target_tag
          );
      UPDATE public.knowledge_file_tags ft SET tag_id=target_tag
        FROM public.knowledge_files f, public.datasets d
        WHERE ft.tag_id=legacy.id AND ft.file_id=f.id AND f.dataset_id=d.id AND d.owner_tenant_id=target;
    END LOOP;
  END LOOP;
  INSERT INTO public.workspace_data_migrations(version,details) VALUES(
    '20261031_knowledge_tags_workspace',
    jsonb_build_object('legacy_tags',old_count,'assigned_originals',assigned_count,'created_copies',copied_count)
  );
END $migration$;
COMMIT;
-- Rollback requires the pre-migration backup, including file-tag links and sequence state.
-- Do not restore global UNIQUE(name) after independent tenant tags have been created.
