/** UI policy only; the backend remains authoritative for access and mutations. */
export interface TenantApp {
  id: number;
  owner_tenant_id?: number | null;
  is_default?: boolean;
  status?: string;
  visibility?: string;
  app_type?: string;
  platform?: string;
}
interface Actor {
  id?: number;
  tenant_id?: number | null;
  isSuperAdmin?: boolean;
  isTenantAdmin?: boolean;
  roles?: Array<string | { name: string }>;
}
function hasRole(user: Actor, name: string) {
  return user.roles?.some((role) =>
    typeof role === "string" ? role === name : role.name === name
  );
}
export function canManageTenantDefault(app: TenantApp | null, user: Actor | null): boolean {
  if (!app || !user || app.owner_tenant_id == null) return false;
  const admin =
    user.isSuperAdmin ||
    hasRole(user, "超级管理员") ||
    ((user.isTenantAdmin || hasRole(user, "租户管理员")) && user.tenant_id === app.owner_tenant_id);
  return (
    !!admin &&
    (app.is_default === true ||
      (app.status === "published" &&
        app.app_type === "Chat" &&
        app.platform === "Web" &&
        ["tenant", "public"].includes(app.visibility || "")))
  );
}
export function appSelectionKey(userId: number, tenantId: number | null | undefined): string {
  return `ragent_selected_app_id:${userId}:${tenantId ?? "none"}`;
}
export function chooseTenantApp(
  apps: TenantApp[],
  saved: string | null,
  tenantId: number | null | undefined
): string {
  if (saved && apps.some((app) => String(app.id) === saved)) return saved;
  if (tenantId == null) return "";
  const ownDefault = apps.find(
    (app) =>
      app.is_default &&
      app.owner_tenant_id === tenantId &&
      app.status === "published" &&
      app.app_type === "Chat" &&
      app.platform === "Web" &&
      ["tenant", "public"].includes(app.visibility || "")
  );
  return ownDefault ? String(ownDefault.id) : "";
}
