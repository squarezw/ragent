/** Display guards only. The backend enforces permissions and tenant balance atomically. */
export function canAllocateUserCredits(
  actor: { isSuperAdmin?: boolean; isTenantAdmin?: boolean; tenant_id?: number | null } | null,
  target: { tenant_id?: number | null }
): boolean {
  if (!actor || !target.tenant_id) return false;
  return Boolean(
    actor.isSuperAdmin || (actor.isTenantAdmin && actor.tenant_id === target.tenant_id)
  );
}

export function allocationAmount(value: string, tenantBalance: number | null): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value);
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    tenantBalance === null ||
    !Number.isFinite(tenantBalance) ||
    amount > tenantBalance
  )
    return null;
  return amount;
}

export function allocationErrorKey(error: unknown) {
  const response = (
    error as {
      response?: { status?: number; data?: { code?: string; detail?: { code?: string } } };
    }
  )?.response;
  const code = response?.data?.detail?.code || response?.data?.code;
  switch (code) {
    case "INSUFFICIENT_TENANT_BALANCE":
      return "creditInsufficientTenant";
    case "FORBIDDEN":
      return "creditForbidden";
    case "INVALID_AMOUNT":
      return "creditInvalidAmount";
    case "NO_TENANT":
      return "creditNoTenant";
    case "IDEMPOTENCY_CONFLICT":
      return "creditRequestConflict";
    case "ACCOUNT_TENANT_MISMATCH":
      return "creditAccountMismatch";
    case "USER_CREDIT_ACCOUNT_BUSY":
      return "creditAccountBusy";
    default:
      return response ? "creditAllocationFailed" : "creditAllocationUncertain";
  }
}
