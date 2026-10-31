/** Only resource endpoints that independently revalidate actor and tenant may be previewed. */
export function workspacePreviewSource(raw: string, origins: string[]): string | null {
  try {
    const base = "https://workspace.invalid";
    const url = new URL(raw, base);
    if (url.username || url.password || url.hash) return null;
    if (raw.startsWith("//") || (!raw.startsWith("/") && !origins.includes(url.origin))) return null;
    const local = raw.startsWith("/") ? url.origin === base : origins.includes(url.origin);
    if (!local) return null;
    if (!(
      /^\/api\/oss\/[^/].+/.test(url.pathname) ||
      /^\/api\/uploads\/[^/]+$/.test(url.pathname) && /^[1-9]\d*$/.test(url.searchParams.get("file_id") || "") ||
      /^\/api\/v1\/skills\/[1-9]\d*\/asset-content$/.test(url.pathname) && !!url.searchParams.get("path") ||
      /^\/api\/v1\/process-management\/process-documents\/[A-Za-z0-9_-]+\/file$/.test(url.pathname)
    )) return null;
    url.searchParams.delete("workspace_tenant_id");
    return url.pathname + url.search;
  } catch { return null; }
}
