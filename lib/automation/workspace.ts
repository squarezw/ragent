import { AsyncLocalStorage } from "node:async_hooks";
import type { WorkspaceContext } from "@/lib/workspaceTenant";
import { workspaceEnabled } from "@/lib/workspaceTenant";

// Request-local operation tenant. Schedulers use the task/run's persisted tenant,
// never a browser selection or the creator's current account tenant.
const scope = new AsyncLocalStorage<WorkspaceContext>();
export function withAutomationWorkspace<T>(context: WorkspaceContext, callback: () => T): T {
  return scope.run(context, callback);
}
export function automationWorkspaceContext() {
  return scope.getStore();
}
export function automationWorkspaceTenant(): number | null {
  const context = scope.getStore();
  if (!workspaceEnabled() || !context?.enabled) return null;
  if (!Number.isSafeInteger(context.tenantId) || Number(context.tenantId) <= 0)
    throw new Error("WORKSPACE_TENANT_REQUIRED");
  return context.tenantId;
}
export function automationTenantClause(alias = ""): string {
  if (alias && !/^[a-z_]+$/.test(alias)) throw new Error("INVALID_SQL_ALIAS");
  const tenantId = automationWorkspaceTenant();
  // Only a validated server-generated integer can reach SQL, never request text.
  return tenantId == null ? "" : ` AND ${alias ? `${alias}.` : ""}tenant_id = ${tenantId}`;
}

/** Background scans must not inherit the HTTP request that first initialized cron. */
export function withoutAutomationWorkspace<T>(callback: () => T): T {
  return scope.exit(callback);
}
