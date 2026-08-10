"use client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import {
  Building2,
  GitGraph,
  Home,
  LibraryBig,
  Network,
  Lock,
  MessageCircle,
  MessageSquare,
  MessageSquareMore,
  Monitor,
  MoreHorizontal,
  Package,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFeatures } from "./FeaturesProvider";

export default function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useCurrentUser();
  const t = useTranslations("navigation");
  const tc = useTranslations("common");
  const features = useFeatures();
  const {
    platformLogo,
    platformName,
    platformSubtitle,
    loading: systemSettingsLoading,
  } = useSystemSettings();

  // 使用新的权限系统
  const isSuperAdmin = checkSuperAdmin(user);
  const isTenantAdmin = checkTenantAdmin(user);
  const isDeptAdmin = user?.isDeptAdmin || false;
  const canManageOperation = isSuperAdmin || isTenantAdmin || isDeptAdmin;
  const canManageOrg = user?.canManageOrg || false;
  const canManageStaff = user?.canManageStaff || false;

  // 待审数徽标（60s 轮询；仅超管/租户管理员可见审核队列）

  type MenuItem = {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    path: string;
    visible?: boolean;
    /** 右侧数字徽标（0 不显示） */
    badge?: number;
    /**
     * 已弃用：置灰 + 不可点 + hover 说明去哪。
     *
     * 只变淡不禁用是最坏的做法——看着像禁用、点进去还能改，用户于是在一个不再生效的
     * 地方编辑内容。所以这里同时切断点击。
     */
    deprecated?: string;
  };
  type MenuGroup = { label: string; visible: boolean; items: MenuItem[] };

  const menuGroups: MenuGroup[] = [
    {
      label: t("coreFeatures"),
      visible: true,
      items: [
        { title: t("home"), icon: Home, path: "/" },
        { title: t("datasets"), icon: LibraryBig, path: "/datasets" },
        { title: t("apps"), icon: Smartphone, path: "/apps" },
        { title: t("chat"), icon: MessageCircle, path: "/chat" },
      ],
    },
    {
      label: t("operations"),
      visible: true,
      items: [
        {
          title: t("processManagement"),
          icon: Network,
          path: "/process-management",
          visible: features.processManagement,
        },
        { title: t("sopManagement"), icon: ShieldCheck, path: "/sop", visible: canManageOperation },
        {
          title: t("skuManagement"),
          icon: Package,
          path: "/products",
          visible: canManageOperation,
        },
        { title: t("knowledgeGraph"), icon: GitGraph, path: "/graph", visible: canManageOperation },
      ],
    },
    {
      label: t("organization"),
      visible: canManageOrg || canManageStaff,
      items: [
        {
          title: t("orgManagement"),
          icon: Building2,
          path: "/organization",
          visible: canManageOrg,
        },
        { title: t("userManagement"), icon: User, path: "/user", visible: canManageStaff },
      ],
    },
    {
      label: isSuperAdmin || isTenantAdmin ? t("admin") : t("myArea"),
      visible: true,
      items: [
        { title: t("chatSessions"), icon: MessageSquareMore, path: "/chat-sessions" },
        {
          // P5 开放自建：普通用户也可创建自己的 Skill（草稿走提交审核）
          title: t("skillsManagement"),
          icon: Sparkles,
          path: "/skills",
        },
        {
          title: t("systemMonitoring"),
          icon: Monitor,
          path: "/monitoring",
          visible: isSuperAdmin,
        },
        { title: t("toolsManagement"), icon: Wrench, path: "/tools", visible: isSuperAdmin },
        {
          title: t("systemSettings"),
          icon: Settings,
          path: "/system-settings",
          visible: isSuperAdmin,
        },
      ],
    },
  ];

  return (
    <Sidebar className="border-r">
      <SidebarHeader className="border-b p-4">
        {systemSettingsLoading ? (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-muted animate-pulse" />
            <div className="flex-1">
              <div className="h-5 w-24 bg-muted rounded animate-pulse mb-1" />
              <div className="h-3 w-16 bg-muted rounded animate-pulse" />
            </div>
          </div>
        ) : platformLogo || platformName ? (
          <div className="flex items-center gap-2">
            {platformLogo && (
              <img
                src={platformLogo}
                alt="Platform Logo"
                className="h-8 w-auto max-w-[80px] object-contain"
                onError={(e) => {
                  // 如果图片加载失败，隐藏图片
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            {platformName ? (
              <div>
                <h2 className="text-lg font-semibold">{platformName}</h2>
                {platformSubtitle && (
                  <p className="text-xs text-muted-foreground">{platformSubtitle}</p>
                )}
              </div>
            ) : platformLogo ? (
              <div>
                <h2 className="text-lg font-semibold">{tc("platformName")}</h2>
                {platformSubtitle && (
                  <p className="text-xs text-muted-foreground">{platformSubtitle}</p>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground font-bold">
              {tc("platformLogoText")}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{tc("platformName")}</h2>
              {platformSubtitle ? (
                <p className="text-xs text-muted-foreground">{platformSubtitle}</p>
              ) : null}
            </div>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        {menuGroups
          .filter((group) => group.visible)
          .map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items
                    .filter((item) => item.visible !== false)
                    .map((item) => (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          onClick={item.deprecated ? undefined : () => router.push(item.path)}
                          // disabled 来自 React.ComponentProps<"button">，真会切断点击；
                          // tooltip 是 SidebarMenuButton 自带的（侧边栏收起时也能显示，
                          // 原生 title 在 disabled 按钮上各浏览器行为还不一致）
                          disabled={!!item.deprecated}
                          tooltip={item.deprecated}
                          className={
                            item.deprecated
                              ? "opacity-50 cursor-not-allowed pointer-events-auto"
                              : undefined
                          }
                          isActive={
                            !item.deprecated &&
                            (pathname === item.path ||
                              (item.path !== "/" && pathname.startsWith(item.path + "/")))
                          }
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          {item.badge != null && item.badge > 0 && (
                            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground">
                              {item.badge > 99 ? "99+" : item.badge}
                            </span>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
      </SidebarContent>
      <SidebarFooter className="border-t p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <User className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {user?.nickname || user?.username || "-"}
            </p>
            <p className="text-xs text-muted-foreground truncate">{user?.email || "-"}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Settings className="mr-2 h-4 w-4" />
                {t("settings")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  localStorage.removeItem("ragent_logged_in");
                  window.location.reload();
                }}
              >
                <Lock className="mr-2 h-4 w-4" />
                {t("logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
