"use client";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useWorkspace } from "./WorkspaceProvider";
export default function WorkspaceBoundary({ children }: { children: React.ReactNode }) {
  const { enabled, ready, tenant, isSuperAdmin } = useWorkspace();
  const path = usePathname();
  const t = useTranslations("navigation");
  if (!enabled) return <>{children}</>;
  if (!ready) return null;
  if (
    !tenant &&
    !["/organization", "/platform-settings", "/settings", "/system-settings"].includes(path || "")
  )
    return <p className="p-6 text-muted-foreground">{t(isSuperAdmin ? "workspaceSelectFirst" : "workspaceTenantUnavailable")}</p>;
  return <>{children}</>;
}
