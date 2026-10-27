export interface TenantModel {
  code: string;
  display_name: string;
  api_model: string;
  base_url: string;
  owner_tenant_id: number;
  auth_mode: "none" | "bearer";
  has_api_key: boolean;
  supports_tools: boolean;
  supports_images: boolean;
  enabled: boolean;
}
export interface ModelDraft {
  display_name: string;
  api_model: string;
  base_url: string;
  auth_mode: "none" | "bearer";
  api_key: string;
  clear_api_key: boolean;
  supports_tools: boolean;
  supports_images: boolean;
  enabled: boolean;
}
export function modelPayload(draft: ModelDraft, editing: boolean, tenantId?: number) {
  const payload: Record<string, unknown> = {
    display_name: draft.display_name.trim(),
    api_model: draft.api_model.trim(),
    base_url: draft.base_url.trim(),
    auth_mode: draft.auth_mode,
    supports_tools: draft.supports_tools,
    supports_images: draft.supports_images,
    enabled: draft.enabled,
  };
  if (!editing && tenantId) payload.owner_tenant_id = tenantId;
  if (draft.clear_api_key) {
    payload.clear_api_key = true;
    payload.auth_mode = "none";
  } else if (draft.auth_mode === "bearer" && draft.api_key.trim())
    payload.api_key = draft.api_key.trim();
  return payload;
}
export function modelCatalogAccess(
  viewerTenantId: number | null | undefined,
  superAdmin: boolean,
  ownerTenantId: number | null | undefined
) {
  const owner = Number(ownerTenantId);
  return Number.isSafeInteger(owner) && owner > 0 && (superAdmin || owner === viewerTenantId)
    ? { tenantId: owner, includeCustom: true }
    : { tenantId: null, includeCustom: false };
}
export function modelCatalogUrl(tenantId?: number | null, includeCustom = true) {
  if (!includeCustom) return "/api/v1/llm-models?include_custom=false";
  return `/api/v1/llm-models${tenantId ? `?owner_tenant_id=${tenantId}` : ""}`;
}
