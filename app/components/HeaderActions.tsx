"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Bell, RefreshCw } from "lucide-react";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePendingReviewCount } from "@/hooks/useReviews";
import { usePendingTenantCount } from "@/hooks/usePendingTenantCount";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";

export default function HeaderActions() {
  const t = useTranslations("navigation");
  const router = useRouter();
  const { user } = useCurrentUser();

  // 审核队列从左侧菜单搬到铃铛。**权限与待办数一起搬**——只挪链接会让没有审核权的人也
  // 看到入口，点进去才被页面拦下；入口本身就不该出现。
  const canReviewQueue = checkSuperAdmin(user) || checkTenantAdmin(user);
  const reviewCount = usePendingReviewCount(canReviewQueue);
  const isSuperAdmin = checkSuperAdmin(user);
  const { count: tenantCount, error: tenantError } = usePendingTenantCount(isSuperAdmin);
  const pendingCount = reviewCount + tenantCount;

  return (
    <div className="flex items-center gap-4">
      {canReviewQueue && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="relative h-8 w-8"
              title={t("notifications")}
              aria-label={t("notifications")}
            >
              <Bell className="h-4 w-4" />
              {pendingCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => router.push("/reviews")}>
              {t("reviewQueue")} ({reviewCount})
            </DropdownMenuItem>
            {isSuperAdmin && (
              <DropdownMenuItem onSelect={() => router.push("/user")}>
                {tenantError
                  ? t("pendingTenantUnavailable")
                  : t("pendingTenantCount", { count: tenantCount })}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        <RefreshCw className="h-4 w-4" />
      </Button>
      <LocaleSwitcher />
    </div>
  );
}
