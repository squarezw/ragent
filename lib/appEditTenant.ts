/** Editing never transfers ownership implicitly; the backend validates migration. */
export function editTenantFields(
  isSuperAdmin: boolean,
  original: number | null | undefined,
  selected: string
) {
  if (!isSuperAdmin || (!selected && original == null) || Number(selected) === original) return {};
  const id = Number(selected);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("TENANT_REQUIRED");
  return { owner_tenant_id: id };
}

export function datasetsForEditTenant<
  T extends { id: string; name: string; owner_tenant_id?: number | null; visibility?: string },
>(datasets: T[], selectedIds: string[], tenantId: string, changed: boolean) {
  const rows = datasets.filter(
    (dataset) =>
      !changed ||
      selectedIds.includes(dataset.id) ||
      dataset.owner_tenant_id === Number(tenantId) ||
      dataset.visibility === "public"
  );
  const present = new Set(rows.map((dataset) => dataset.id));
  return [
    ...rows,
    ...selectedIds
      .filter((id) => !present.has(id))
      .map((id) => ({ id, name: id, dimension: undefined })),
  ];
}
