export function isProcessMgmtEnabled(): boolean {
  return !!process.env.PROCESS_MGMT_BASE_URL;
}

export function requireProcessMgmtBaseUrl(): string {
  const url = process.env.PROCESS_MGMT_BASE_URL;
  if (!url) {
    throw new Error(
      "PROCESS_MGMT_BASE_URL is not configured; process-management module is disabled in this deployment"
    );
  }
  return url;
}
