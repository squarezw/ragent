export interface QaErrorLike {
  code?: string;
  statusCode?: number;
  message?: string;
  response?: { status?: number; data?: unknown };
}

export function makeQaBackendError(
  status: number,
  body: unknown
): Error & { statusCode: number; code?: string } {
  let payload = body;
  if (typeof body === "string") {
    try {
      payload = JSON.parse(body);
    } catch {
      payload = {};
    }
  }
  const detail = (payload as { detail?: unknown })?.detail;
  const record = detail as { message?: unknown; code?: unknown } | undefined;
  const message =
    typeof detail === "string"
      ? detail
      : typeof record?.message === "string"
        ? record.message
        : `External service error (${status})`;
  return Object.assign(new Error(message), {
    statusCode: status,
    code: typeof record?.code === "string" ? record.code : undefined,
  });
}

export function creditChatCode(
  error: QaErrorLike
):
  | "insufficient_balance"
  | "user_credit_account_busy"
  | "user_credit_reconciliation_required"
  | undefined {
  const status = error.statusCode || error.response?.status;
  if (status === 402) return "insufficient_balance";
  if (status !== 409) return undefined;
  const detail = (error.response?.data as { detail?: { code?: string } })?.detail;
  const code = detail?.code || error.code;
  if (code === "USER_CREDIT_ACCOUNT_BUSY") return "user_credit_account_busy";
  if (code === "USER_CREDIT_RECONCILIATION_REQUIRED") return "user_credit_reconciliation_required";
  return undefined;
}
