/** Creation-only tenant selection. Server authorization remains authoritative. */
export function createTenantFields(isSuperAdmin: boolean, tenantId: string) {
  if (!isSuperAdmin) return {};
  const id = Number(tenantId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("TENANT_REQUIRED");
  return { owner_tenant_id: id };
}

export function datasetsForCreateTenant<
  T extends { owner_tenant_id?: number | null; visibility?: string },
>(datasets: T[], isSuperAdmin: boolean, editing: boolean, tenantId: string): T[] {
  if (!isSuperAdmin || editing) return datasets;
  const id = Number(tenantId);
  return Number.isSafeInteger(id) && id > 0
    ? datasets.filter(
        (dataset) => dataset.owner_tenant_id === id || dataset.visibility === "public"
      )
    : [];
}

export function clearTenantBindings<
  T extends { dataset_ids: string[]; settings: Record<string, unknown> },
>(form: T): T {
  const { workflow: _workflow, wechat: _wechat, ...settings } = form.settings;
  return { ...form, dataset_ids: [], settings: { ...settings, auto_select_datasets: true } };
}
