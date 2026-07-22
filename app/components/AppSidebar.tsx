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

  type MenuItem = {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    path: string;
    visible?: boolean;
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
        { title: t("skuManagement"), icon: Package, path: "/products", visible: canManageOperation },
        { title: t("knowledgeGraph"), icon: GitGraph, path: "/graph", visible: canManageOperation },
      ],
    },
    {
      label: t("organization"),
      visible: canManageOrg || canManageStaff,
      items: [
        { title: t("orgManagement"), icon: Building2, path: "/organization", visible: canManageOrg },
        { title: t("userManagement"), icon: User, path: "/user", visible: canManageStaff },
      ],
    },
    {
      label: isSuperAdmin || isTenantAdmin ? t("admin") : t("myArea"),
      visible: true,
      items: [
        { title: t("chatSessions"), icon: MessageSquareMore, path: "/chat-sessions" },
        {
          title: t("promptManagement"),
          icon: MessageSquare,
          path: "/prompts",
          visible: isSuperAdmin || isTenantAdmin,
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
                          onClick={() => router.push(item.path)}
                          isActive={
                            pathname === item.path ||
                            (item.path !== "/" && pathname.startsWith(item.path + "/"))
                          }
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
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
