"use client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { isPendingTenant } from "@/lib/clientPermissions";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function TenantBoundary({ children }: { children: React.ReactNode }) {
  const { user, loading, refetch } = useCurrentUser();
  const path = usePathname() || "/";
  const t = useTranslations("navigation");
  if (loading || !user) return null;
  if (!isPendingTenant(user)) return <>{children}</>;
  const allowed = ["/settings", "/system-settings", "/chat-sessions"].some(
    (p) => path === p || path.startsWith(p + "/")
  );
  return <div className="w-full space-y-4">
    <div role="status" className="rounded-lg border bg-muted p-4">
      <h2 className="font-semibold">{t("pendingTenantTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("pendingTenantDescription")}</p>
      <Button variant="outline" className="mt-3" onClick={() => void refetch()}>{t("refreshTenantStatus")}</Button>
    </div>
    {allowed ? children : null}
  </div>;
}
