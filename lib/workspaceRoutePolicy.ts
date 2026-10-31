/** Explicit audited proxy routes; unknown business APIs fail closed when enabled. */
export const workspaceProxyRoutes = [
  "/api/v1/sandbox-images",
  "/api/v1/prompt-variables",
  "/api/v1/llm-models",
  "/api/v1/llm-models/custom/[code]",
  "/api/v1/llm-models/custom",
  "/api/v1/crawler/fetch",
  "/api/v1/wechat/agents",
  "/api/v1/github/connection",
  "/api/v1/github/oauth/start",
  "/api/v1/github/oauth/exchange",
  "/api/v1/github/oauth/config",
  "/api/v1/skills/requires-options",
  "/api/v1/skills",
  "/api/v1/skills/[id]/publish",
  "/api/v1/skills/[id]/diff",
  "/api/v1/skills/[id]/git-sync",
  "/api/v1/skills/[id]/git-source",
  "/api/v1/skills/[id]/review",
  "/api/v1/skills/[id]/export",
  "/api/v1/skills/[id]/submit-review",
  "/api/v1/skills/[id]/asset-content",
  "/api/v1/skills/[id]/exec-config",
  "/api/v1/skills/[id]",
  "/api/v1/skills/[id]/tenant",
  "/api/v1/skills/[id]/user-env/meta",
  "/api/v1/skills/[id]/user-env",
  "/api/v1/skills/[id]/assets/[...path]",
  "/api/v1/skills/[id]/assets/archive",
  "/api/v1/skills/[id]/assets",
  "/api/v1/skills/import/validate",
  "/api/v1/skills/import",
  "/api/v1/apps/[id]",
  "/api/v1/apps",
  "/api/v1/apps/[id]/review",
  "/api/v1/apps/[id]/submit-review",
  "/api/v1/apps/[id]/datasets/cleanup-unavailable",
  "/api/v1/apps/[id]/agent-md/generate",
  "/api/v1/apps/[id]/agent-md",
  "/api/v1/apps/[id]/skills/[skillId]",
  "/api/v1/apps/[id]/skills/diagnostics",
  "/api/v1/apps/[id]/skills",
  "/api/v1/billing/recharge",
  "/api/v1/billing/user-balances",
  "/api/v1/billing/user-accounts",
  "/api/v1/billing/recharges",
  "/api/v1/billing/accounts",
  "/api/v1/billing/my-account",
  "/api/v1/billing/user-allocations",
  "/api/v1/billing/rates",
  "/api/v1/billing/rates/audit",
  "/api/v1/billing/rates/[rate_type]/[ref_key]",
  "/api/v1/billing/usage/turns",
  "/api/v1/billing/usage/summary",
  "/api/v1/reviews/pending",
  "/api/v1/reviews/log",
  "/api/tools/builtin",
  "/api/tools/[id]",
  "/api/tools",
  "/api/tools/executions",
  "/api/tools/[id]/statistics",
  "/api/tools/[id]/test-connection",
  "/api/chat/feedback",
  "/api/images/[filename]",
  "/api/uploads/convert-docx",
  "/api/uploads/convert-excel",
  "/api/wechat/send",
  "/api/wechat/oauth/authorize",
  "/api/preference",
  "/api/file-preview/office",
  "/api/public/feedback",
  "/api/oss/presign",
  "/api/monitoring/license-status",
  "/api/monitoring/system-status",
  "/api/monitoring/vector-entity-count",
  "/api/apps/simple",
  "/api/apps/[id]",
  "/api/apps/[id]/tools/statistics",
  "/api/apps/[id]/tools/batch",
  "/api/apps/[id]/tools/[toolId]",
  "/api/apps/[id]/tools",
  "/api/stt/single-speaker",
  "/api/stt/tasks/[taskId]",
] as const;
export const workspaceDirectRoutes: string[] = [
  "/api/v1/email/unread-config",
  "/api/v1/observe/summary",
  "/api/v1/observe/orders",
  "/api/v1/observe/orders/[orderId]",
  "/api/v1/observe/orders/[orderId]/logs",
  "/api/internal/onlyoffice/config/[id]",
  "/api/internal/onlyoffice/force-save",
  "/api/internal/docx/convert",
  "/api/chat/preview-artifact",
  "/api/chat/preview-dxf",
  "/api/pdf/markdown-to-pdf",
  "/api/v1/crawler/test",
  "/api/dashboard/statistics",
  "/api/uploads/[filename]",
  "/api/products",
  "/api/products/[id]",
  "/api/products/batch",
  "/api/products/import",
  "/api/products/vector-search",
  "/api/products/template",
  "/api/automation/run",
  "/api/automation/callback",
  "/api/automation/webhook",
  "/api/v1/automations",
  "/api/v1/automations/[id]",
  "/api/v1/automations/[id]/run",
  "/api/v1/automation-runs",
  "/api/v1/automation-runs/[id]/review",
  "/api/v1/automation-mailboxes",
  "/api/v1/automation-mailboxes/[id]",
  "/api/v1/automation-email/stats",
  "/api/v1/automation-notifications",

  "/api/v1/process-management/handbook/sessions/[sessionId]",
  "/api/v1/process-management/handbook/download/[sessionId]",
  "/api/v1/process-management/handbook/generate/[sessionId]/status",
  "/api/v1/process-management/handbook/analyze/[sessionId]/status",
  "/api/v1/process-management/handbook/analyze/[sessionId]/result",

  "/api/v1/process-management/process-tree",
  "/api/v1/process-management/process-nodes/[id]",
  "/api/v1/process-management/process-nodes",
  "/api/v1/process-management/process-nodes/[id]/documents",
  "/api/v1/process-management/process-documents/[id]",
  "/api/v1/process-management/process-documents",
  "/api/v1/process-management/process-documents/[id]/new-revision",
  "/api/v1/process-management/process-documents/[id]/status",
  "/api/v1/process-management/process-documents/[id]/prepare-review",
  "/api/v1/process-management/process-documents/[id]/ingest-prepared-pdf",
  "/api/v1/process-management/process-documents/[id]/move",
  "/api/v1/process-management/process-documents/[id]/latest-version",
  "/api/v1/process-management/process-documents/[id]/file",
  "/api/v1/process-management/process-documents/[id]/review",
  "/api/v1/process-management/process-documents/[id]/discard-revision",
  "/api/v1/process-management/process-documents/[id]/change-summaries",
  "/api/v1/process-management/process-documents/[id]/versions/[version]/status",
  "/api/v1/process-management/handbook/convert",
  "/api/v1/process-management/handbook/sessions",
  "/api/v1/process-management/handbook/generate",
  "/api/v1/process-management/handbook/analyze",

  "/api/datasets/search",
  "/api/datasets/[id]",
  "/api/datasets/batch",
  "/api/datasets",
  "/api/datasets/tasks/[task_id]",
  "/api/datasets/[id]/files",
  "/api/knowledge/replace",
  "/api/knowledge/category",
  "/api/knowledge/tags-summary",
  "/api/knowledge/search",
  "/api/knowledge/vectorize-unsegmented-files",
  "/api/knowledge/check-duplicates",
  "/api/knowledge/graph",
  "/api/knowledge/vectorize-file",
  "/api/knowledge/segments",
  "/api/knowledge/file-tags",
  "/api/knowledge/vectorize-files-batch",
  "/api/knowledge/files-across-datasets",
  "/api/knowledge/list",
  "/api/knowledge/file-status",
  "/api/knowledge/tags",
  "/api/knowledge/update",
  "/api/knowledge/upload-confirm",
  "/api/knowledge/delete",
  "/api/knowledge/graph/statistics",
  "/api/knowledge/segments/by-ids",
  "/api/knowledge/segments/vectorize",
  "/api/knowledge/segments/update",
  "/api/chat/qa",
  "/api/file-preview/stream-url",
  "/api/file-preview/stream",
  "/api/file-preview/create-link",
  "/api/chat/upload-confirm",
  "/api/chat/sessions",
  "/api/chat/session/history",
  "/api/chat/sessions/filters",
  "/api/chat/sessions/export",
  "/api/chat/sessions/[id]/details",
  "/api/user/list",
  "/api/user/create",
  "/api/user/update",
  "/api/user/delete",
  "/api/oss/[...key]",
  "/api/oss/sign-urls",
];
export function workspaceRouteMatches(route: string, path: string): boolean {
  const pattern = route
    .split("/")
    .map((part) =>
      part.startsWith("[...")
        ? ".+"
        : part.startsWith("[")
          ? "[^/]+"
          : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("/");
  return new RegExp(`^${pattern}/?$`).test(path);
}
export function workspaceRoutePolicy(path: string): "exempt" | "covered" | "blocked" {
  if (
    /^\/api\/(auth\/|workspace\/context$|user\/(me|login|register|phone-config|phone|change-phone)$|organization\/|public\/)/.test(
      path
    )
  )
    return "exempt";
  if (
    ["/api/internal/onlyoffice/callback"].includes(path) ||
    workspaceRouteMatches("/api/internal/onlyoffice/download/[id]", path) ||
    workspaceRouteMatches("/api/internal/download/[fileId]", path)
  )
    return "exempt";
  if (["/api/automation/callback", "/api/automation/webhook"].includes(path)) return "exempt";
  if (path === "/api/file-preview/file" || /^\/api\/file-preview\/file-[^/]+$/.test(path))
    return "exempt";
  if (workspaceRouteMatches("/api/v1/zn-oa/callback/[oa_request_id]", path)) return "exempt";
  // Public branding files are resource-scoped by their existing public OSS category.
  if (path.startsWith("/api/oss/system/")) return "exempt";
  // Platform configuration and user preference routes retain their own authorization.
  if (/^\/api\/v1\/password\//.test(path)) return "exempt";
  if (
    [
      "/api/system",
      "/api/user/update",
      "/api/system/upload-logo-confirm",
      "/api/system/logo-presign",
      "/api/preference",
      "/api/user/pending-tenant-count",
    ].includes(path)
  )
    return "exempt";
  if (
    [...workspaceProxyRoutes, ...workspaceDirectRoutes].some((route) =>
      workspaceRouteMatches(route, path)
    )
  )
    return "covered";
  // Legacy Office callback filenames are all served by one signed-capability handler.
  if (workspaceRouteMatches("/api/file-preview/[filename]", path)) return "exempt";
  return "blocked";
}
