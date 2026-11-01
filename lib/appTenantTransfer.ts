/** Server-authoritative, metadata-only transfer protocol. */
export interface TransferIssue {
  code: string;
  message: string;
  count?: number;
  confirmation_required?: boolean;
}
export interface TransferPreview {
  app_id: number;
  source: { tenant_id: number; tenant_name: string };
  target: { tenant_id: number; tenant_name: string };
  expected_version: string;
  preflight_token: string | null;
  expires_at: string | null;
  can_apply: boolean;
  warnings: TransferIssue[];
  blockers: TransferIssue[];
  checks: { code: string; status: "passed" | "blocked" | "unverified" }[];
  bindings: {
    kind: string;
    id: string | number;
    name?: string | null;
    target_scope_available: boolean;
  }[];
  target_defaults: {
    status: string;
    visibility: string;
    owner_dept_id: number | null;
    is_default: boolean;
  };
}
export interface TransferResult {
  app_id: number;
  transfer_id: string;
  from_tenant_id: number;
  to_tenant_id: number;
  status: string;
  visibility: string;
  history_moved: false;
  next_workspace_tenant_id: number;
  rollback: { eligible: boolean; reason_code?: string };
}
export function canConfirmTransfer(
  preview: TransferPreview | null,
  acknowledged: string[],
  reason: string,
  now = Date.now()
): boolean {
  return (
    !!preview &&
    preview.can_apply === true &&
    preview.blockers.length === 0 &&
    preview.checks.every((check) => check.status === "passed") &&
    !!preview.preflight_token &&
    !!preview.expected_version &&
    !!preview.expires_at &&
    Date.parse(preview.expires_at) > now &&
    reason.trim().length > 0 &&
    preview.warnings.every((warning) => acknowledged.includes(warning.code))
  );
}
export function transferPayload(
  preview: TransferPreview,
  acknowledged: string[],
  reason: string,
  idempotencyKey: string
) {
  if (!canConfirmTransfer(preview, acknowledged, reason)) throw new Error("TRANSFER_NOT_READY");
  return {
    target_tenant_id: preview.target.tenant_id,
    expected_version: preview.expected_version,
    preflight_token: preview.preflight_token,
    confirmed_warning_codes: acknowledged,
    reason: reason.trim(),
    idempotency_key: idempotencyKey,
  };
}
